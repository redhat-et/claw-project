# Your first AI assistant on OpenShift

Get a personal AI coding assistant running on your OpenShift
cluster — then expand it to your whole team. This guide covers
**Scenario D** (personal assistant) and **Scenario A** (shared
team assistant). They use the same minimal CRD; the team
version just adds a second provider and a shared profile.

## Story

Jordan is an ML engineer who wants an AI coding assistant on
the cluster — no cloud SaaS, no data leaving the network.
Jordan creates a Kubernetes Secret with an Anthropic API key,
applies a one-field Claw CR, and opens the generated URL in a
browser. Five minutes from start to finish.

A week later, Jordan's team lead Alex wants the same thing for
the whole platform engineering team of eight. Alex adds a
second provider, seeds a shared profile from Git, and shares
the URL. The team is up and running in ten minutes.

## Prerequisites

- OpenShift cluster with the Claw operator installed
- `oc` CLI authenticated with permissions to create Secrets
  and Claw resources in the target namespace
- At least one LLM provider API key (Anthropic, Google, or
  other supported provider)

## Part one: personal assistant (Scenario D)

### The manifest

The simplest possible Claw CR — just credentials:

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: jordan-assistant
spec:
  credentials:
    - name: anthropic
      provider: anthropic
      secretRef:
        - name: jordan-anthropic
          key: api-key
```

A ready-to-use version is at
`manifests/scenarios/scenario-d-power-user.yaml` in the
[claw-collections][collections] repository.

The `provider` field tells the operator to infer the credential
type, API domain, and authentication headers automatically:

| Provider | Inferred type | Domain | Auth header |
| -------- | ------------- | ------ | ----------- |
| `anthropic` | `apiKey` | `api.anthropic.com` | `x-api-key` |
| `google` | `apiKey` | `.googleapis.com` | `x-goog-api-key` |
| `openai` | `bearer` | `api.openai.com` | `Authorization: Bearer` |
| `xai` | `bearer` | `api.x.ai` | `Authorization: Bearer` |

### Deploy

Create a namespace, a secret, and apply the CR:

```bash
oc new-project ai-dev

oc create secret generic jordan-anthropic \
  --from-literal=api-key='sk-ant-...' \
  -n ai-dev
```

Save the manifest as `jordan-assistant.yaml` (add
`namespace: ai-dev` under `metadata`) and apply:

```bash
oc apply -f jordan-assistant.yaml
```

### Verify

Check that the instance is ready:

```bash
oc get claw jordan-assistant -n ai-dev \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
# Expected: True
```

Get the access URL:

```bash
oc get claw jordan-assistant -n ai-dev \
  -o jsonpath='{.status.gatewayURL}'
```

Open the URL in a browser. You should see the OpenClaw
interface ready to accept prompts.

### What you get

- A browser-based AI coding assistant at a stable Route URL
- Persistent workspace on a PVC — conversations and
  customizations survive pod restarts
- Full control over persona, skills, and model configuration
  through the OpenClaw UI
- The proxy enforces the credential security boundary — your
  API key never reaches the gateway container

## Part two: expand to a shared team (Scenario A)

The same pattern scales to a team of 5-10 developers. The
changes are small: add a second provider, optionally seed a
shared profile, and share the URL.

### The manifest

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: dev-team
spec:
  credentials:
    - name: anthropic
      provider: anthropic
      secretRef:
        - name: team-anthropic
          key: api-key
    - name: gemini
      provider: google
      secretRef:
        - name: team-gemini
          key: api-key
  agentFiles:
    applyPolicy: IfMissing
    git:
      url: https://github.com/redhat-et/claw-collections.git
      ref: main
      path: enterprise-profiles/shared-team
```

A ready-to-use version is at
`manifests/scenarios/scenario-a-shared-team.yaml` in the
[claw-collections][collections] repository.

**What changed from the personal version:**

- **Second provider** — the team can choose between Anthropic
  and Gemini at runtime
- **`agentFiles`** — seeds a general-purpose development
  assistant profile (AGENTS.md, SOUL.md, TOOLS.md) from the
  [shared-team collection][profile] so the team starts with a
  useful persona instead of a blank slate
- **`applyPolicy: IfMissing`** — seeded files do not overwrite
  any customizations the team has already made on the PVC

The `agentFiles` block is optional. Without it, the operator
seeds a generic default persona.

### Deploy

```bash
oc new-project ai-dev

# Anthropic
oc create secret generic team-anthropic \
  --from-literal=api-key='sk-ant-...' \
  -n ai-dev

# Google Gemini (optional, if using a second provider)
oc create secret generic team-gemini \
  --from-literal=api-key='AIza...' \
  -n ai-dev
```

Save the manifest as `dev-team.yaml` (add `namespace: ai-dev`
under `metadata`) and apply:

```bash
oc apply -f dev-team.yaml
```

### Verify

```bash
oc get claw dev-team -n ai-dev \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
# Expected: True
```

Check that pods are running:

```bash
oc get pods -n ai-dev -l app.kubernetes.io/instance=dev-team
```

### Share with the team

Get the access URL and send it to your team members:

```bash
oc get claw dev-team -n ai-dev \
  -o jsonpath='{.status.gatewayURL}'
```

Anyone with the URL can access the assistant. The
authentication token is embedded in the URL fragment
(after `#`). Per RFC 3986, fragments are not sent in HTTP
requests, so the token does not appear in server access logs
or proxy logs. It is visible in the browser address bar,
history, and bookmarks — treat the URL as a credential and
share it through a secure channel.

## Deploy via GitOps

Both manifests work with [Red Hat OpenShift GitOps][gitops]
(ArgoCD). If your cluster has the claw-collections
ApplicationSet configured (see
[GitOps setup](../gitops-setup.md)), deploy by pushing the
manifest to Git instead of running `oc apply`.

Clone the repository and copy a manifest into your directory:

```bash
git clone git@github.com:redhat-et/claw-collections.git
cd claw-collections
cp manifests/scenarios/scenario-d-power-user.yaml \
   manifests/<your-username>/my-assistant.yaml
```

Push to trigger ArgoCD sync:

```bash
git add manifests/<your-username>/my-assistant.yaml
git commit -m "Add my assistant"
git push origin main
```

ArgoCD creates the `<your-username>-claw` namespace
automatically and syncs the Claw CR. Create the provider
secret in that namespace:

```bash
oc create secret generic jordan-anthropic \
  --from-literal=api-key='sk-ant-...' \
  -n <your-username>-claw
```

The Claw resource appears within about 5 minutes. The
operator does not crash if the secret is missing — the
instance stays in `Ready: False` until the secret exists.

[gitops]: https://docs.openshift.com/gitops/latest/understanding_openshift_gitops/about-redhat-openshift-gitops.html

## What happens behind the scenes

When the Claw CR is applied, the operator:

1. Creates a gateway Deployment (the OpenClaw web UI)
1. Creates a credential proxy Deployment (injects API keys
   into outbound LLM requests)
1. Creates a PVC for persistent workspace storage
1. Creates a Route for external access
1. Generates an authentication token Secret
1. Seeds persona files (AGENTS.md, SOUL.md) into the workspace
   via the init-config container

The API key never reaches the gateway container — the proxy
intercepts outbound requests and injects credentials at the
network level.

## Cleanup

To remove the deployment:

```bash
oc delete claw jordan-assistant -n ai-dev
```

The operator deletes the gateway, proxy, and Route. The PVC
is retained by default so workspace data is not lost
accidentally. To remove it:

```bash
oc delete pvc -n ai-dev \
  -l app.kubernetes.io/instance=jordan-assistant
```

To remove the secrets and namespace entirely:

```bash
oc delete project ai-dev
```

## Next steps

- **Per-department customization:** See
  [Scenario B](../enterprise-onboarding-workflows.md#scenario-b-per-department-assistants-with-curated-profiles)
  to seed department-specific personas and skills from a
  Git repo

[collections]: https://github.com/redhat-et/claw-collections
[profile]: https://github.com/redhat-et/claw-collections/tree/main/enterprise-profiles/shared-team
