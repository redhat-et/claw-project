# Sealed Secrets for GitOps credential storage

Store Claw credentials (LLM API keys, GitHub PATs) in Git
safely using [Bitnami Sealed Secrets][sealed]. The Sealed
Secrets controller decrypts them into regular Kubernetes
Secrets on the cluster — the Claw operator reads them via
`spec.credentials[].secretRef` with no changes to the Claw CR.

## Why Sealed Secrets

The [GitOps setup](gitops-setup.md) workflow stores Claw
manifests in Git, but credentials must be created manually
with `oc create secret`. This breaks the GitOps model — the
admin must run a manual step per user, per namespace, outside
of Git.

Sealed Secrets closes the gap: the admin encrypts a secret
locally, commits the encrypted SealedSecret to Git alongside
the Claw manifest, and ArgoCD syncs both. No manual step on
the cluster.

```text
Local                          Git                 Cluster
──────                         ───                 ───────
Secret ──kubeseal──► SealedSecret ──ArgoCD──► SealedSecret
                                                    │
                                              controller
                                                    │
                                                    ▼
                                                 Secret
                                                    │
                                              Claw operator
                                                    │
                                                    ▼
                                              proxy injects
                                              credentials
```

## Prerequisites

- OpenShift cluster with the Claw operator installed
- [GitOps setup](gitops-setup.md) completed (ArgoCD +
  ApplicationSet)
- `oc` CLI authenticated as a cluster admin (for controller
  installation) or namespace admin (for creating
  SealedSecrets)

## Cluster admin setup

These steps are performed once per cluster.

### Install the Sealed Secrets controller

> Check the [releases page][releases] for the latest version
> before installing. The commands below use v0.38.1, which was
> current at the time of writing.

```bash
oc apply -f https://github.com/bitnami/sealed-secrets/releases/download/v0.38.1/controller.yaml
```

[releases]: https://github.com/bitnami/sealed-secrets/releases

Verify the controller is running:

```bash
oc get pods -n kube-system -l name=sealed-secrets-controller
```

### Install the kubeseal CLI

On macOS:

```bash
brew install kubeseal
```

On Linux (amd64):

```bash
KUBESEAL_VERSION=0.38.1
curl -OL "https://github.com/bitnami/sealed-secrets/releases/download/v${KUBESEAL_VERSION}/kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz"
tar -xzf "kubeseal-${KUBESEAL_VERSION}-linux-amd64.tar.gz" kubeseal
sudo install -m 755 kubeseal /usr/local/bin/kubeseal
```

Verify `kubeseal` can reach the controller:

```bash
kubeseal --fetch-cert
```

This should print the controller's public certificate. If it
fails, check that your `oc` context points to the right
cluster.

## Encrypt a credential

### LLM provider key

Create a regular Secret manifest (do **not** apply it to the
cluster):

```bash
oc create secret generic anthropic-key \
  --from-literal=api-key='sk-ant-...' \
  --namespace=panni-claw \
  --dry-run=client -o yaml > /tmp/anthropic-key.yaml
```

Encrypt it with `kubeseal`:

```bash
kubeseal --format yaml \
  < /tmp/anthropic-key.yaml \
  > manifests/panni/anthropic-key-sealed.yaml
```

Delete the plaintext file:

```bash
rm /tmp/anthropic-key.yaml
```

The resulting `anthropic-key-sealed.yaml` is safe to commit —
it can only be decrypted by the controller on the cluster
that generated the certificate.

### GitHub PAT

The same pattern works for any credential. For the
[GitHub-aware assistant](scenarios/github-api-assistant.md):

```bash
oc create secret generic github-pat \
  --from-literal=token='github_pat_...' \
  --namespace=panni-claw \
  --dry-run=client -o yaml \
  | kubeseal --format yaml \
  > manifests/panni/github-pat-sealed.yaml
```

## Commit alongside the Claw manifest

The encrypted SealedSecrets live in the same directory as
the Claw manifests. ArgoCD syncs both:

```text
manifests/
  panni/
    my-assistant.yaml              # Claw CR
    anthropic-key-sealed.yaml      # SealedSecret
    github-pat-sealed.yaml         # SealedSecret
```

Push to Git:

```bash
cd claw-collections
git add manifests/panni/
git commit -m "Add assistant with sealed credentials"
git push origin main
```

ArgoCD syncs the SealedSecrets to the cluster. The Sealed
Secrets controller decrypts each one into a regular Secret.
The Claw operator reads the Secrets via `secretRef` — no
change to the Claw CR is needed.

## ArgoCD configuration

ArgoCD needs permission to manage SealedSecret resources.
Add a ClusterRole (similar to the Claw resources role from
[GitOps setup](gitops-setup.md)):

```bash
cat <<'EOF' | oc apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: argocd-manage-sealed-secrets
  labels:
    app.kubernetes.io/part-of: argocd
rules:
- apiGroups:
  - bitnami.com
  resources:
  - sealedsecrets
  verbs:
  - get
  - list
  - watch
  - create
  - update
  - patch
  - delete
EOF
```

Bind it to the ArgoCD application controller:

```bash
cat <<'EOF' | oc apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: argocd-manage-sealed-secrets
  labels:
    app.kubernetes.io/part-of: argocd
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: argocd-manage-sealed-secrets
subjects:
- kind: ServiceAccount
  name: openshift-gitops-argocd-application-controller
  namespace: openshift-gitops
EOF
```

## Verify

After ArgoCD syncs, check that the Secret was created:

```bash
oc get secret anthropic-key -n panni-claw
```

The Secret should exist with `Type: Opaque` and the expected
data keys. Verify the Claw instance resolves the credential:

```bash
oc get claw my-assistant -n panni-claw \
  -o jsonpath='{.status.conditions[?(@.type=="CredentialsResolved")].status}'
# Expected: True
```

## Rotate a credential

Sealed Secrets does not support automatic rotation. To rotate
a credential:

1. Generate a new API key from the provider
1. Re-encrypt the secret with `kubeseal`
1. Commit and push the updated SealedSecret
1. ArgoCD syncs the new SealedSecret to the cluster
1. The controller updates the underlying Secret
1. The Claw operator detects the change via the secret
   version annotation and triggers a pod rollout

```bash
oc create secret generic anthropic-key \
  --from-literal=api-key='sk-ant-NEW-KEY-HERE' \
  --namespace=panni-claw \
  --dry-run=client -o yaml \
  | kubeseal --format yaml \
  > manifests/panni/anthropic-key-sealed.yaml

cd claw-collections
git add manifests/panni/anthropic-key-sealed.yaml
git commit -m "Rotate Anthropic API key"
git push origin main
```

## Namespace scoping

SealedSecrets are scoped to a **specific namespace and name**
by default. A SealedSecret encrypted for `panni-claw` cannot
be decrypted in `dylan-claw` — even if the encrypted YAML is
copied there. This prevents a user from reusing another
user's credentials by copying their SealedSecret file.

If you need a secret available in multiple namespaces,
encrypt it separately for each namespace.

## Limitations

- **No automatic rotation** — re-encrypt and commit on every
  key change. For automatic rotation, see the
  [External Secrets Operator integration][eso-issue]
  (Vault, AWS Secrets Manager, Azure Key Vault)
- **Cluster-bound encryption** — the SealedSecret can only
  be decrypted by the cluster whose certificate was used. If
  you reinstall the controller or move to a new cluster, you
  need to re-encrypt all secrets with the new certificate
- **Certificate backup** — back up the controller's private
  key (`oc get secret -n kube-system -l sealedsecrets.bitnami.com/sealed-secrets-key`)
  so you can restore decryption capability after a cluster
  rebuild

## Next steps

- **Vault + External Secrets Operator** — for enterprise
  environments that need automatic rotation, dynamic
  credentials, and audit trails, see [#45][eso-issue]
- **Per-department onboarding** — combine SealedSecrets with
  the [GitOps setup](gitops-setup.md) to onboard departments
  with fully declarative, Git-managed deployments

[sealed]: https://github.com/bitnami/sealed-secrets
[eso-issue]: https://github.com/redhat-et/claw-project/issues/45
