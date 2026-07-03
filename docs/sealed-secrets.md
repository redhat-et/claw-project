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
the Claw manifest, and Argo CD syncs both. No manual step on
the cluster.

```text
Local                          Git                 Cluster
──────                         ───                 ───────
Secret ──kubeseal──► SealedSecret ──Argo CD──► SealedSecret
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
- [GitOps setup](gitops-setup.md) completed (Argo CD +
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

### Vertex AI service account key

Vertex AI uses a JSON key file instead of a simple string
token. Create the service account and download the key first:

```bash
gcloud iam service-accounts create claw-vertex \
  --display-name="Claw Vertex AI"
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:claw-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=claw-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Then encrypt the key file as a SealedSecret:

```bash
oc create secret generic vertex-sa-key \
  --from-file=sa-key.json=sa-key.json \
  --namespace=panni-claw \
  --dry-run=client -o yaml \
  | kubeseal --format yaml \
  > manifests/panni/vertex-sa-key-sealed.yaml
```

Delete the plaintext key file from your local machine:

```bash
rm sa-key.json
```

> **Note:** `--from-file` produces a larger Secret than
> `--from-literal` because the JSON key contains multiple
> fields. The SealedSecret will be correspondingly larger,
> but this has no effect on functionality.

## Deploy

Store the encrypted SealedSecrets in Git alongside the Claw
manifests:

```text
my-claw-deployment/
  claw.yaml                      # Claw CR
  anthropic-key-sealed.yaml      # SealedSecret
  github-pat-sealed.yaml         # SealedSecret (optional)
```

### Option A: direct apply from Git

The simplest approach — clone the repo and apply everything
with `oc apply`. No Argo CD required.

```bash
git clone git@github.com:your-org/your-claw-deployment.git
cd your-claw-deployment

oc new-project ai-planning
oc apply -f .
```

The Sealed Secrets controller decrypts each SealedSecret
into a regular Secret. The Claw operator reads the Secrets
via `secretRef` and starts the instance. The entire
deployment is reproducible from a single `git clone` and
`oc apply`.

To update credentials or configuration, edit and re-apply:

```bash
git pull
oc apply -f .
```

Alternatively, apply directly from a GitHub raw URL without
cloning:

```bash
oc new-project ai-planning
oc apply -f https://raw.githubusercontent.com/your-org/your-claw-deployment/main/anthropic-key-sealed.yaml
oc apply -f https://raw.githubusercontent.com/your-org/your-claw-deployment/main/claw.yaml
```

This is useful for quick demos or when sharing a deployment
with a colleague — one command per file, no local checkout
needed.

### Option B: Argo CD GitOps

If your cluster runs Argo CD (see
[GitOps setup](gitops-setup.md)), push the SealedSecrets
to the claw-collections repository alongside the Claw
manifests:

```text
manifests/
  panni/
    my-assistant.yaml              # Claw CR
    anthropic-key-sealed.yaml      # SealedSecret
    github-pat-sealed.yaml         # SealedSecret
```

```bash
cd claw-collections
git add manifests/panni/
git commit -m "Add assistant with sealed credentials"
git push origin main
```

Argo CD syncs both the SealedSecrets and the Claw CR
automatically. The Sealed Secrets controller decrypts each
one into a regular Secret. No `oc apply` needed after the
initial Argo CD setup.

#### Argo CD RBAC

Argo CD needs permission to manage SealedSecret resources.
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

Bind it to the Argo CD application controller:

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

After applying (or after Argo CD syncs), check that the
Secret was created:

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
1. Argo CD syncs the new SealedSecret to the cluster
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

## Scope and portability

SealedSecrets are bound to a **specific namespace, name, and
cluster** by default.

**Namespace + name binding:** A SealedSecret encrypted for
`panni-claw/anthropic-key` cannot be decrypted in
`dylan-claw/anthropic-key` — the controller rejects it
because the namespace and name are part of the encrypted
envelope. This prevents a user from reusing another user's
credentials by copying their SealedSecret file.

**Cluster binding:** Each Sealed Secrets controller generates
its own RSA key pair on first startup. The public key (what
`kubeseal --fetch-cert` returns) encrypts; the private key
(stored in `kube-system`) decrypts. A SealedSecret encrypted
with one cluster's public key cannot be decrypted by another
cluster's controller. If you have staging and production
clusters, you encrypt the same credential separately for
each cluster — even if the namespace and secret name match.

If you need a secret available in multiple namespaces or
across clusters, encrypt it separately for each target.

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
