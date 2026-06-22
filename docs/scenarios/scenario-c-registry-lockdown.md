# Registry lockdown and internal mirrors

Deploy per-user AI assistants on a security-conscious cluster
that blocks public registries and routes traffic through
internal mirrors. Each user gets their own API key for cost
attribution.

This guide covers **Scenario C** from the
[enterprise onboarding workflows](../enterprise-onboarding-workflows.md).
It builds on the concepts from
[Your first AI assistant](scenario-a-shared-team.md) — read
that guide first if you haven't deployed a Claw instance
before.

## Story

Priya runs IT security for a financial services firm. The
firm's OpenShift clusters block outbound traffic to public
registries — npm, ClawHub, and OpenRouter are not reachable.
Developers can only install packages from the internal npm
mirror at `npm.corp.internal`.

Priya wants to give each developer their own AI assistant with
individual API keys for cost attribution, but the assistants
must respect the network restrictions. The internal npm mirror
must be reachable; everything else follows the corporate
allowlist.

## How it works

### Network control with builtinPassthroughs

By default, the Claw proxy allows traffic to several public
domains (npm, ClawHub, GitHub, OpenRouter). The
`builtinPassthroughs` field is an **allowlist** — only listed
domains are permitted; omitted builtins are blocked.

| builtinPassthroughs value | Effect |
| ------------------------- | ------ |
| absent (default) | All builtins allowed |
| `[]` (empty list) | All builtins blocked |
| `[github.com, ...]` | Only listed domains allowed |

### Internal mirrors with type: none credentials

When public registries are blocked, internal mirrors replace
them. A `type: none` credential tells the proxy to route
traffic to a domain without injecting any authentication
headers — useful for internal mirrors that rely on network-level
access control instead of API keys.

```yaml
credentials:
  - name: internal-npm
    type: none
    domain: npm.corp.internal
```

### Per-user API keys

Each developer gets their own Claw CR referencing their own
API key Secret. This enables cost attribution — the LLM
provider bills each key separately, so the firm can track
spending per developer or per team.

## The manifest

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: jane-doe
spec:
  credentials:
    - name: anthropic
      provider: anthropic
      secretRef:
        - name: jane-anthropic-key
          key: api-key
    - name: internal-npm
      type: none
      domain: npm.corp.internal
  network:
    builtinPassthroughs:
      - github.com
      - codeload.github.com
  agentFiles:
    applyPolicy: IfMissing
    git:
      url: https://github.com/redhat-et/claw-collections.git
      ref: main
      path: enterprise-profiles/standard-user
```

A ready-to-use version is at
`manifests/scenarios/scenario-c-registry-lockdown.yaml` in the
[claw-collections][collections] repository.

**What's different from Scenario A/D:**

- **`builtinPassthroughs`** — only GitHub is allowed; npm,
  ClawHub, and OpenRouter are blocked
- **`type: none` credential** — routes traffic to the internal
  npm mirror without authentication
- **Per-user CR** — each developer gets their own instance and
  API key

**What's blocked:** The proxy rejects connections to any domain
not in the allowlist or credential list. A developer trying to
run `npm install` from the public npm registry gets a
connection error. Packages from `npm.corp.internal` work
normally.

### Private Git repos

If the corporate config repo is private, add a `secretRef` to
the `agentFiles.git` section:

```yaml
agentFiles:
  git:
    url: https://git.corp.internal/configs.git
    ref: main
    path: standard-user
    secretRef:
      name: git-credentials
```

Create the Secret with a username and password (or token):

```bash
oc create secret generic git-credentials \
  --from-literal=username='deploy-bot' \
  --from-literal=password='ghp_...' \
  -n ai-users
```

## Deploy

### Manual deploy

Create the namespace and secrets for one user:

```bash
oc new-project ai-users

# Per-user LLM provider key
oc create secret generic jane-anthropic-key \
  --from-literal=api-key='sk-ant-...' \
  -n ai-users
```

Save the manifest as `jane-doe.yaml` (add `namespace: ai-users`
under `metadata`) and apply:

```bash
oc apply -f jane-doe.yaml
```

Repeat for each developer — one Secret and one CR per person.

### GitOps via ArgoCD

For teams with many developers, GitOps is more practical than
manual `oc apply` for each user. See
[GitOps setup](../gitops-setup.md) for the full ArgoCD
configuration.

Each developer creates a manifest in their directory:

```bash
cp manifests/scenarios/scenario-c-registry-lockdown.yaml \
   manifests/<username>/my-assistant.yaml
```

Edit the manifest to use their own secret name, push, and
ArgoCD handles the rest. The admin creates the per-user API
key secret in the `<username>-claw` namespace.

## Verify

### Check the instance is ready

```bash
oc get claw jane-doe -n ai-users \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
# Expected: True
```

### Verify public registries are blocked

Exec into the gateway pod and test that npm is unreachable:

```bash
POD=$(oc get pods -n ai-users \
  -l app.kubernetes.io/instance=jane-doe,app.kubernetes.io/component=gateway \
  -o jsonpath='{.items[0].metadata.name}')

oc exec -n ai-users "$POD" -- \
  curl -sf https://registry.npmjs.org/ && echo "FAIL: npm reachable" \
  || echo "OK: npm blocked"
```

### Verify internal mirror is reachable

```bash
oc exec -n ai-users "$POD" -- \
  curl -sf https://npm.corp.internal/ && echo "OK: mirror reachable" \
  || echo "FAIL: mirror unreachable"
```

### Verify GitHub is allowed

```bash
oc exec -n ai-users "$POD" -- \
  curl -sf https://github.com/ -o /dev/null && echo "OK: GitHub reachable" \
  || echo "FAIL: GitHub blocked"
```

### Get the access URL

```bash
oc get claw jane-doe -n ai-users \
  -o jsonpath='{.status.gatewayURL}'
```

## Scaling to many users

For organizations with dozens of developers, automate the
per-user provisioning:

1. **GitOps** — each developer maintains their own manifest
   in `manifests/<username>/`. ArgoCD syncs automatically.
2. **Shared network policy** — the `builtinPassthroughs` and
   `type: none` credential blocks are identical across all
   users. Use a base manifest that developers copy.
3. **Secret management** — use ExternalSecrets or
   SealedSecrets to manage API keys at scale instead of
   manual `oc create secret`.
4. **Cost attribution** — each user's API key maps to their
   provider dashboard, enabling per-developer spend reports.

## Cleanup

```bash
oc delete claw jane-doe -n ai-users
oc delete secret jane-anthropic-key -n ai-users
```

The PVC is retained by default. To remove it:

```bash
oc delete pvc -n ai-users \
  -l app.kubernetes.io/instance=jane-doe
```

## Next steps

- **Read-only guardrails:** See
  [Scenario F](../enterprise-onboarding-workflows.md#scenario-f-locked-down-kiosk-with-guardrails)
  to add persona protection and config lockdown on top of
  registry control
- **Plugin restriction:** Add
  `spec.restrictions.pluginInstallation: false` to explicitly
  block plugin installation (in addition to network blocking)

[collections]: https://github.com/redhat-et/claw-collections
