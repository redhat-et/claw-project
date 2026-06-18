# GitOps for OpenClaw with ArgoCD

Deploy OpenClaw instances by pushing YAML manifests to Git.
**OpenShift GitOps** (ArgoCD) watches the
[claw-collections][repo] repository and automatically syncs
Claw resources to the cluster.

Each user gets a subdirectory under `manifests/` — ArgoCD
creates an Application per directory, targeting the matching
`<username>-claw` namespace. Namespaces are created
automatically on first sync.

```text
manifests/
  panni/
    claw-vertex-claude-assistant.yaml
    claw-vertex-claude-financial.yaml
  dylan/
    claw-openai-assistant.yaml
  cooktheryan/
    ...
```

[repo]: https://github.com/redhat-et/claw-collections

---

## Cluster admin setup

These steps are performed once by the cluster admin.

### Install OpenShift GitOps

Install the **OpenShift GitOps** operator from the OpenShift
**Software Catalog** (OperatorHub). Accept the defaults — the
operator creates an ArgoCD instance in the `openshift-gitops`
namespace automatically. No extra configuration is needed.

Verify the install:

```bash
oc get argocd -n openshift-gitops
```

The operator also creates a route for the ArgoCD UI:

```bash
oc get route -n openshift-gitops
```

### Grant ArgoCD access to Claw resources

ArgoCD's controller has read-only access to all API groups by
default, but needs **write** access for Claw custom resources.
Create a separate ClusterRole (not editing the operator-managed
one, which could be reverted on reconcile):

```bash
cat <<'EOF' | oc apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: argocd-manage-claw-resources
  labels:
    app.kubernetes.io/part-of: argocd
rules:
- apiGroups:
  - claw.sandbox.redhat.com
  resources:
  - claws
  - clawdevicepairingrequests
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
  name: argocd-manage-claw-resources
  labels:
    app.kubernetes.io/part-of: argocd
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: argocd-manage-claw-resources
subjects:
- kind: ServiceAccount
  name: openshift-gitops-argocd-application-controller
  namespace: openshift-gitops
EOF
```

Verify:

```bash
oc auth can-i create claws.claw.sandbox.redhat.com \
  --as=system:serviceaccount:openshift-gitops:openshift-gitops-argocd-application-controller \
  -n default
# Expected: yes
```

### Create the ApplicationSet

The ApplicationSet scans `manifests/` for subdirectories and
creates one ArgoCD Application per directory. Each directory
name maps to a `<name>-claw` namespace.

```bash
cat <<'EOF' | oc apply -f -
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: claw-per-user
  namespace: openshift-gitops
spec:
  generators:
  - git:
      repoURL: https://github.com/redhat-et/claw-collections.git
      revision: main
      directories:
      - path: manifests/*
  template:
    metadata:
      name: 'claw-{{path.basename}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/redhat-et/claw-collections.git
        targetRevision: main
        path: '{{path}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{path.basename}}-claw'
      syncPolicy:
        automated:
          selfHeal: true
          prune: false
        syncOptions:
        - CreateNamespace=true
EOF
```

| Sync setting | Value | Effect |
| ------------ | ----- | ------ |
| `automated` | enabled | ArgoCD syncs on every detected change |
| `selfHeal` | `true` | Manual cluster edits are reverted to match Git |
| `prune` | `false` | Removing a manifest from Git does **not** delete the resource |
| `CreateNamespace` | `true` | Namespace is created automatically on first sync |

### Onboard a new user

When a new user creates their directory under `manifests/` and
pushes, ArgoCD auto-creates the namespace and deploys their
manifests. The admin then creates the user's LLM provider
secret(s) in that namespace.

#### Google Vertex AI (Claude via GCP)

```bash
oc create secret generic vertex-sa-key \
  -n <username>-claw \
  --from-file=sa-key.json=/path/to/service-account-key.json
```

The user gets their service account key from GCP Console →
IAM → Service Accounts. The account needs the
`roles/aiplatform.user` role. See the
[Deployer Guide](deployer-guide.md#one-time-setup-your-vertex-service-account)
for details.

#### OpenAI (direct)

```bash
oc create secret generic openai-api-key \
  -n <username>-claw \
  --from-literal=api-key=sk-...
```

#### Anthropic (direct)

```bash
oc create secret generic anthropic-api-key \
  -n <username>-claw \
  --from-literal=api-key=sk-ant-...
```

> [!NOTE]
> The Claw operator does not crash if a secret is missing — the
> Claw resource will be created but won't become Ready until the
> referenced secret exists. The user can push their manifest
> first; the admin adds the secret whenever ready.

### Monitor deployments

```bash
# List all ArgoCD-generated Applications
oc get applications.argoproj.io -n openshift-gitops

# Check a specific user's sync status
oc get applications.argoproj.io claw-<username> -n openshift-gitops

# List all Claw instances across all namespaces
oc get claw -A
```

---

## User guide

### Prerequisites

- Access to the [claw-collections][repo] repository (push to
  `main`)
- Your LLM provider credentials — give these to the cluster
  admin so they can create the secret in your namespace

### Clone the repository

```bash
git clone git@github.com:redhat-et/claw-collections.git
cd claw-collections
```

### Create your directory

Create a subdirectory under `manifests/` using your username.
This name determines your namespace (`<username>-claw`):

```bash
mkdir manifests/<your-username>
```

### Write your Claw manifest

Create a YAML file in your directory. The filename can be
anything — ArgoCD applies all `.yaml` files it finds.

#### Claude via Vertex AI

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: my-assistant
spec:
  version: "2026.6.8"
  credentials:
    - name: anthropic-vertex
      type: gcp
      secretRef:
        - name: vertex-sa-key
          key: sa-key.json
      gcp:
        project: "your-gcp-project-id"
        location: "global"
      provider: anthropic
  agentFiles:
    git:
      url: https://github.com/redhat-et/claw-collections.git
      ref: main
      path: enterprise-profiles/executive-assistant
```

#### Anthropic (direct API key)

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: my-anthropic-agent
spec:
  credentials:
    - name: anthropic
      provider: anthropic
      secretRef:
        - name: anthropic-api-key
          key: api-key
```

#### OpenAI (direct)

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: my-openai-agent
spec:
  credentials:
    - name: openai
      provider: openai
      secretRef:
        - name: openai-api-key
          key: api-key
```

For known providers (`anthropic`, `openai`, `google`, `xai`,
`openrouter`), the operator infers credential type and domain
automatically — you only need `name`, `provider`, and
`secretRef`. For the full list of providers, custom/self-hosted
models, MCP servers, and other configuration, see the
[Claw Operator User Guide][user-guide].

You can deploy multiple Claw instances — just create one YAML
file per instance in your directory.

[user-guide]: https://github.com/redhat-et/claw-operator/blob/main/docs/user-guide.md

### Push and deploy

```bash
git add manifests/<your-username>/
git commit -m "Add Claw manifests for <your-username>"
git push origin main
```

ArgoCD polls the repo every 3 minutes. Your namespace and Claw
resources will appear within **about 5 minutes**. Check status:

```bash
oc get claw -n <your-username>-claw
```

If the Claw shows `Ready: False`, ask the cluster admin to
verify your provider secret is in place.

### Update or add instances

Edit your manifests or add new YAML files and push. ArgoCD
picks up changes automatically — no need to run `oc apply`.

> [!IMPORTANT]
> Do **not** change `metadata.name` of an existing manifest.
> ArgoCD treats it as a new resource and leaves the old one
> running. If you need to rename, delete the old Claw first:
> `oc delete claw <old-name> -n <your-username>-claw`

---

## How ArgoCD sync works

### Self-healing

If someone manually deletes a Claw resource from the cluster,
ArgoCD detects the drift and restores it within about one
minute. Git is the source of truth.

### Sync timing

ArgoCD polls the Git repo periodically. In practice, changes
take **up to 5 minutes** to appear on the cluster. Faster
sync is possible with a [GitHub webhook][webhook].

### Pruning

We use `prune: false` for safety. If you remove a YAML file
from Git, the Claw resource stays running on the cluster —
it becomes an orphan that ArgoCD no longer tracks. Delete
orphans manually with `oc delete claw`.

[webhook]: https://argo-cd.readthedocs.io/en/stable/operator-manual/webhook/
