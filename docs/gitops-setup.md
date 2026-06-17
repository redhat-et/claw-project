# GitOps for OpenClaw with ArgoCD

This guide walks through setting up a GitOps pipeline so that
pushing a Claw manifest to Git automatically deploys it on
OpenShift. We use **OpenShift GitOps** (ArgoCD) to watch a Git
repo and reconcile Claw custom resources on the cluster.

## Install OpenShift GitOps

Install the **OpenShift GitOps** operator from the OpenShift
**Software Catalog** (OperatorHub). Accept the defaults — the
operator creates an ArgoCD instance in the `openshift-gitops`
namespace automatically. No extra configuration needed.

Verify the install:

```bash
oc get argocd -n openshift-gitops
```

You should see an instance named `openshift-gitops`. The operator
also creates a route for the ArgoCD UI:

```bash
oc get route -n openshift-gitops
```

> [!NOTE]
> OpenShift GitOps ships with a `default` AppProject that allows
> all source repos and all destination namespaces. This is fine for
> getting started, but in production you should scope it down.

## Grant ArgoCD access to Claw resources

ArgoCD's controller has read-only access to all API groups by
default, but it needs **write** access to create and update Claw
custom resources. We add a separate ClusterRole rather than editing
the operator-managed one (which could be reverted on reconcile).

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
  -n panni-claw
# Expected: yes
```

## Create an ArgoCD Application

An Application tells ArgoCD *where* to read manifests (source)
and *where* to deploy them (destination). This example watches
the `manifests/` directory in
[claw-collections](https://github.com/redhat-et/claw-collections)
and deploys everything into the `panni-claw` namespace:

```bash
cat <<'EOF' | oc apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: claw-panni
  namespace: openshift-gitops
spec:
  project: default
  source:
    repoURL: https://github.com/redhat-et/claw-collections.git
    targetRevision: main
    path: manifests
  destination:
    server: https://kubernetes.default.svc
    namespace: panni-claw
  syncPolicy:
    automated:
      selfHeal: true
      prune: false
    syncOptions:
    - CreateNamespace=false
EOF
```

Check the sync status:

```bash
oc get applications.argoproj.io claw-panni -n openshift-gitops
```

### Sync policy explained

| Setting | Value | Effect |
| ------- | ----- | ------ |
| `automated` | enabled | ArgoCD syncs on every detected change |
| `selfHeal` | `true` | Manual cluster edits are reverted to match Git |
| `prune` | `false` | Removing a manifest from Git does **not** delete the resource |

**Why `prune: false`?** Safety. If you rename a Claw manifest
(change `metadata.name`), ArgoCD creates the new resource but
leaves the old one running as an orphan. You clean it up manually.
With `prune: true`, ArgoCD would delete the old resource
automatically — convenient but risky if you accidentally remove a
file from the repo.

## What we observed

### Self-healing works

Deleting a Claw resource from the cluster manually:

```bash
oc delete claw executive-assistant -n panni-claw
```

ArgoCD detected the drift and restored the resource within
**about one minute**.

### Renaming creates a new instance

Changing `metadata.name` in a manifest (e.g., `hr-specialist` →
`hr-specialist-gitops`) and pushing to `main`:

- ArgoCD created the **new** resource (`hr-specialist-gitops`)
- The **old** resource (`hr-specialist`) continued running
  (orphaned, marked `OutOfSync`)
- Manual cleanup required:
  `oc delete claw hr-specialist -n panni-claw`

### Sync timing

ArgoCD polls the Git repo every **3 minutes** by default. In
practice, changes took **up to 5 minutes** to appear on the
cluster. For faster feedback, you can configure a
[GitHub webhook][webhook] to notify ArgoCD on push.

[webhook]: https://argo-cd.readthedocs.io/en/stable/operator-manual/webhook/

## Scaling to multiple users with ApplicationSet

The single Application above deploys all manifests to one
namespace. For a team where each member has their own namespace
(`panni-claw`, `dylan-claw`, etc.), use an **ApplicationSet**
with a Git Directory generator.

### Target repo structure

Restructure `manifests/` into per-user subdirectories:

```text
manifests/
  panni/
    claw-vertex-claude-assistant.yaml
    claw-vertex-claude-financial.yaml
    claw-vertex-claude-hr.yaml
  dylan/
    claw-vertex-claude-assistant.yaml
  cooktheryan/
    ...
```

### ApplicationSet manifest

```yaml
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
        - CreateNamespace=false
```

The generator scans for subdirectories under `manifests/`. For
each directory (e.g., `panni`), it creates an Application that
deploys that directory's YAMLs to `panni-claw`. Adding a new team
member means creating a new subdirectory and pushing.

> [!NOTE]
> Before applying the ApplicationSet, delete the single-user
> Application to avoid conflicts:
> `oc delete applications.argoproj.io claw-panni -n openshift-gitops`
