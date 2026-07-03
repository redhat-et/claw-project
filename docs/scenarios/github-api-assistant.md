# GitHub-aware project assistant

Give your AI assistant read access to GitHub repositories so
it can discuss project status, review issues and PRs, and
help with project planning — all without exposing your
credentials to the agent.

This guide demonstrates that the proxy credential system is
**not LLM-specific**. The same `bearer` injector that handles
OpenAI tokens works for any HTTP API with header-based
authentication, including the GitHub REST API.

## Story

Priya leads a platform engineering team that maintains several
related repositories. She wants an AI assistant that can see
across all the repos — read code, review open issues, check
PR status — and help the team prioritize work during planning
sessions. The assistant should be a **read-only advisor**: it
can create issues to capture action items, but it cannot merge
PRs, push code, or modify repository settings.

Priya creates a fine-grained GitHub PAT scoped to exactly the
repositories the assistant needs, injects it through the proxy,
and opens the agent UI to start a planning conversation.

## Prerequisites

- OpenShift cluster with the Claw operator installed
- `oc` CLI authenticated with permissions to create Secrets
  and Claw resources in the target namespace
- An LLM provider API key (Anthropic, Google, or other
  supported provider)
- A GitHub account with access to the target repositories

## Create a fine-grained PAT

Fine-grained PATs can only be created through the GitHub web
UI — there is no CLI or API equivalent. Go to **Settings →
Developer settings → Personal access tokens → Fine-grained
tokens → Generate new token**.

### Token metadata

| Field | Recommended value |
| ----- | ----------------- |
| Token name | `claw-project-assistant` (or similar descriptive name) |
| Expiration | 30 days (short-lived; regenerate as needed) |
| Description | "OpenClaw agent read access for project management" |
| Resource owner | Your organization (e.g., `redhat-et`) |

### Repository access

Select **"Only select repositories"** and choose the
repositories the assistant needs. For example:

- `redhat-et/claw-project`
- `redhat-et/claw-operator`
- `redhat-et/claw-collections`
- `redhat-et/claw-operator-extras`

### Repository permissions

Set these permissions under **"Repository permissions"**:

| Permission | Access level | What it enables |
| ---------- | ------------ | --------------- |
| Contents | Read-only | Read files, directories, branches |
| Issues | Read and write | Read existing issues, create new ones |
| Pull requests | Read-only | Read PRs, review comments, diffs |
| Metadata | Read-only | Granted automatically; labels, milestones |

**Permissions to leave at "No access":**

| Permission | Why |
| ---------- | --- |
| Pull requests: Write | Would allow merging/approving — too much for an advisor |
| Actions | No need to trigger or read CI workflows |
| Administration | Repo settings, webhooks, branch protection — never |
| Commit statuses | Not needed for project planning |

### Account permissions

Leave all account permissions at **"No access"**. The
assistant does not need org-level access.

### Generate and save

Click **Generate token** and copy the value immediately — GitHub
shows it only once. You will use it in the next step to create
a Kubernetes Secret.

> **Note on Issues permissions:** GitHub does not offer
> a "create-only" permission for Issues. Read and write
> grants the ability to create, edit, close, and comment
> on issues. The proxy's `allowedPaths` can further
> restrict which API endpoints the agent reaches if you
> need tighter control.

## Create the Kubernetes secret

Create the secret manually on the cluster:

```bash
oc create secret generic github-pat \
  --from-literal=token='github_pat_...' \
  -n <your-namespace>
```

> **Production alternatives:** For GitOps-safe credential
> storage, see the [Sealed Secrets guide](../sealed-secrets.md)
> — encrypt the secret locally and commit it alongside your
> Claw manifest. For enterprise environments needing automatic
> rotation, see the [External Secrets Operator][eso-issue]
> integration (Vault, AWS Secrets Manager, Azure Key Vault).

[eso-issue]: https://github.com/redhat-et/claw-project/issues/45

## Configure the Claw CR

Add the GitHub credential alongside your LLM credential. The
`agentFiles` section seeds the [project-assistant][profile]
persona — a cross-repo planning assistant that knows how to
use the GitHub API and operates as a read-only advisor.

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: project-assistant
spec:
  agentFiles:
    applyPolicy: IfMissing
    git:
      url: https://github.com/redhat-et/claw-collections.git
      ref: main
      path: enterprise-profiles/project-assistant
  credentials:
    # LLM credential (as usual)
    - name: anthropic
      provider: anthropic
      secretRef:
        - name: anthropic-key
          key: api-key

    # GitHub API credential
    - name: github
      type: bearer
      domain: api.github.com
      secretRef:
        - name: github-pat
          key: token
      allowedPaths:
        - /repos/
        - /user
```

[profile]: https://github.com/redhat-et/claw-collections/tree/main/enterprise-profiles/project-assistant

**Key differences from an LLM credential:**

| Field | LLM credential | GitHub credential |
| ----- | -------------- | ----------------- |
| `provider` | Set (e.g., `anthropic`) | Not set — proxy-only routing |
| `type` | Inferred from provider | Set explicitly: `bearer` |
| `domain` | Inferred from provider | Set explicitly: `api.github.com` |

The `allowedPaths` field restricts which GitHub API endpoints
the agent can reach. With `/repos/` and `/user`, the agent can
access repository data and verify its own identity, but cannot
reach administrative endpoints like `/admin/` or `/orgs/`.

> **Tighter path restrictions:** You can scope `allowedPaths`
> to specific repositories if needed — for example,
> `/repos/redhat-et/claw-project/`,
> `/repos/redhat-et/claw-operator/`, etc. For this
> walkthrough, we rely on the PAT's repository scoping for
> access control and keep `allowedPaths` broad.

## Deploy

### Option A: direct apply

```bash
oc new-project ai-planning

oc create secret generic anthropic-key \
  --from-literal=api-key='sk-ant-...' \
  -n ai-planning

oc create secret generic github-pat \
  --from-literal=token='github_pat_...' \
  -n ai-planning

oc apply -f project-assistant.yaml
```

### Option B: GitOps

If your cluster has the claw-collections ApplicationSet
configured (see [GitOps setup](../gitops-setup.md)), copy the
manifest to your directory in the claw-collections repository
and push:

```bash
cp project-assistant.yaml \
   manifests/<your-directory>/project-assistant.yaml
git add manifests/<your-directory>/project-assistant.yaml
git commit -m "Add project assistant with GitHub access"
git push origin main
```

Argo CD syncs the Claw CR automatically. Create the secrets in
the target namespace — the operator waits gracefully until they
exist:

```bash
oc create secret generic anthropic-key \
  --from-literal=api-key='sk-ant-...' \
  -n <your-directory>-claw

oc create secret generic github-pat \
  --from-literal=token='github_pat_...' \
  -n <your-directory>-claw
```

## Verify

### Instance is ready

```bash
oc get claw project-assistant -n ai-planning \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
# Expected: True
```

### GitHub API is reachable

```bash
POD=$(oc get pods -n ai-planning \
  -l app.kubernetes.io/instance=project-assistant,app.kubernetes.io/component=gateway \
  -o jsonpath='{.items[0].metadata.name}')

# Test: list repos (should succeed)
oc exec -n ai-planning "$POD" -- \
  curl -sf https://api.github.com/user/repos?per_page=1 \
  -o /dev/null -w '%{http_code}\n'
# Expected: 200
```

### Agent cannot see the PAT

```bash
# The PAT should not appear in the gateway environment
oc exec -n ai-planning "$POD" -- env | grep -i github
# Expected: no output (the PAT lives in the proxy, not the gateway)
```

### Blocked paths are denied

```bash
# /admin/ should be blocked by allowedPaths
oc exec -n ai-planning "$POD" -- \
  curl -sf https://api.github.com/admin/users \
  -o /dev/null -w '%{http_code}\n'
# Expected: 403
```

## What the assistant can do

Open the `gatewayURL` in your browser and try these
conversations:

- *"What are the open issues across claw-project and
  claw-operator? Which ones are blockers?"*
- *"Show me the most recent PRs in claw-collections. Are any
  waiting for review?"*
- *"Create an issue in claw-project titled 'Update deployment
  docs for GitHub integration' with a summary of what we
  discussed."*
- *"Compare the README files across all four repos — are there
  inconsistencies in the setup instructions?"*

The assistant can read repository contents, issues, and PRs
across all configured repositories and create issues to
capture decisions. It cannot merge PRs, push code, or modify
repository settings.

## How it works

The flow for a GitHub API call follows the same path as an
LLM request:

1. The agent decides to call the GitHub API (e.g.,
   `GET /repos/redhat-et/claw-project/issues`)
1. The gateway sends the request through `HTTPS_PROXY`
1. The proxy intercepts the CONNECT to `api.github.com`
1. The proxy matches the domain to the `github` credential
1. The proxy strips any auth headers from the request
1. The proxy injects `Authorization: Bearer <PAT>`
1. The proxy checks the path against `allowedPaths`
1. The request reaches GitHub with valid authentication

The agent never sees the raw PAT. The proxy reads it from the
`github-pat` Secret's environment variable at startup.

## Cleanup

```bash
oc delete claw project-assistant -n ai-planning
oc delete secret anthropic-key github-pat -n ai-planning
oc delete pvc -n ai-planning \
  -l app.kubernetes.io/instance=project-assistant
```

## Next steps

- **Persona tuning:** Add an `agentFiles` section to seed a
  SOUL.md that tells the assistant about your project
  structure, team conventions, and planning workflow
- **Additional APIs:** The same `bearer` pattern works for
  GitLab, Jira, Slack, and any HTTP API with header-based
  auth — see [issue #63][issue63] for a full list
- **Active participant:** Once confident in the guardrails,
  grant Pull requests: Write and let the assistant review PRs,
  suggest changes, or post review comments

[issue63]: https://github.com/redhat-et/claw-project/issues/63
