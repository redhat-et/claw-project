# Scenario A: Shared team assistant

A team of 5-10 developers shares one AI assistant with shared
credentials and a default persona. The admin creates one Claw CR
and one Secret — the operator handles everything else.

## Story

Alex leads a platform engineering team of eight. The team wants
an AI coding assistant on their OpenShift cluster — no cloud
SaaS, no data leaving the network. Alex doesn't need per-person
customization yet; the team just wants a shared assistant they
can all use from their browsers.

Alex creates a Kubernetes Secret with the team's Anthropic API
key, applies a minimal Claw CR, and shares the generated URL
with the team. Ten minutes from start to finish.

## What the team gets

- A browser-based AI coding assistant at a stable Route URL
- Default persona (AGENTS.md, SOUL.md) seeded by the operator
- Persistent workspace on a PVC — conversations and
  customizations survive pod restarts
- Each team member can customize the persona through the UI;
  edits persist on the shared PVC

## Prerequisites

- OpenShift cluster with the Claw operator installed
- `oc` CLI authenticated with permissions to create Secrets
  and Claw resources in the target namespace
- At least one LLM provider API key (Anthropic, Google, or
  other supported provider)

## The manifest

A ready-to-use manifest is available in the
[claw-collections][collections] repository at
`manifests/scenarios/scenario-a-shared-team.yaml`.

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

The `agentFiles` block is optional. Without it, the operator
seeds a generic default persona. With it, the team gets a
general-purpose development assistant profile (AGENTS.md,
SOUL.md, TOOLS.md) from the [shared-team collection][profile].
`applyPolicy: IfMissing` means seeded files do not overwrite
any customizations the team has already made on the PVC.

The `provider` field tells the operator to infer the
credential type, API domain, and authentication headers
automatically:

| Provider | Inferred type | Domain | Auth header |
| -------- | ------------- | ------ | ----------- |
| `anthropic` | `apiKey` | `api.anthropic.com` | `x-api-key` |
| `google` | `apiKey` | `.googleapis.com` | `x-goog-api-key` |
| `openai` | `bearer` | `api.openai.com` | `Authorization: Bearer` |
| `xai` | `bearer` | `api.x.ai` | `Authorization: Bearer` |

[collections]: https://github.com/redhat-et/claw-collections
[profile]: https://github.com/redhat-et/claw-collections/tree/main/enterprise-profiles/shared-team

## Deploy

There are two ways to deploy: manually with `oc apply`, or
via GitOps with ArgoCD. Both produce the same result.

### Option A: Manual deploy

Create a namespace and the API key secrets:

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

Save the manifest above as `dev-team.yaml` (add
`namespace: ai-dev` under `metadata`) and apply:

```bash
oc apply -f dev-team.yaml
```

### Option B: GitOps via ArgoCD

If your cluster has [Red Hat OpenShift GitOps][gitops]
configured with the claw-collections ApplicationSet (see
[GitOps setup](../gitops-setup.md)), you can deploy by
pushing the manifest to Git instead.

Clone the repository and copy the manifest into your
directory:

```bash
git clone git@github.com:redhat-et/claw-collections.git
cd claw-collections
cp manifests/scenarios/scenario-a-shared-team.yaml \
   manifests/<your-username>/dev-team.yaml
```

Push to trigger ArgoCD sync:

```bash
git add manifests/<your-username>/dev-team.yaml
git commit -m "Add shared team assistant"
git push origin main
```

ArgoCD creates the `<your-username>-claw` namespace
automatically and syncs the Claw CR. Create the provider
secret in that namespace:

```bash
oc create secret generic team-anthropic \
  --from-literal=api-key='sk-ant-...' \
  -n <your-username>-claw
```

The Claw resource appears within about 5 minutes. The
operator does not crash if the secret is missing — the
instance stays in `Ready: False` until the secret exists.

[gitops]: https://docs.openshift.com/gitops/latest/understanding_openshift_gitops/about-redhat-openshift-gitops.html

## Verify

### Check the Claw status

```bash
oc get claw dev-team -n ai-dev -o yaml | grep -A 20 status:
```

Look for the `Ready` condition set to `True`:

```yaml
status:
  conditions:
    - type: Ready
      status: "True"
      reason: Ready
  gatewayURL: https://dev-team-ai-dev.apps.cluster.example.com/#...
  gatewayTokenSecretRef: dev-team-gateway-token
```

### Check that pods are running

```bash
oc get pods -n ai-dev -l app.kubernetes.io/instance=dev-team
```

You should see the gateway and proxy pods in `Running` state.

### Get the access URL

The `status.gatewayURL` field contains the full URL with the
authentication token fragment:

```bash
oc get claw dev-team -n ai-dev \
  -o jsonpath='{.status.gatewayURL}'
```

Alternatively, retrieve the Route and token separately:

```bash
# Route URL
oc get route -n ai-dev -l app.kubernetes.io/instance=dev-team \
  -o jsonpath='{.items[0].spec.host}'

# Authentication token
oc get secret dev-team-gateway-token -n ai-dev \
  -o jsonpath='{.data.token}' | base64 -d
```

### Test access

Open the `gatewayURL` in a browser. You should see the
OpenClaw interface ready to accept prompts.

## Share with the team

Send the `gatewayURL` to your team members. Anyone with the
URL (which includes the auth token) can access the assistant.

The default authentication mode is token-based — the token is
embedded in the URL fragment (after `#`). It never leaves the
browser and is not sent to the server in HTTP headers, so it
won't appear in proxy logs.

## What happens behind the scenes

When the Claw CR is applied, the operator:

1. Creates a gateway Deployment (the OpenClaw web UI)
1. Creates a credential proxy Deployment (injects API keys
   into outbound LLM requests)
1. Creates a PVC for persistent workspace storage
1. Creates a Route for external access
1. Generates an authentication token Secret
1. Seeds the default persona files (AGENTS.md, SOUL.md) into
   the workspace via the init-config container

The team's API key never reaches the gateway container — the
proxy intercepts outbound requests and injects credentials at
the network level.

## Cleanup

To remove the deployment:

```bash
oc delete claw dev-team -n ai-dev
```

The operator deletes the gateway, proxy, and Route. The PVC
is retained by default so workspace data is not lost
accidentally. To remove it:

```bash
oc delete pvc -n ai-dev -l app.kubernetes.io/instance=dev-team
```

To remove the secrets and namespace entirely:

```bash
oc delete project ai-dev
```

## Next steps

- **Per-department customization:** See
  [Scenario B](scenario-b-department-profiles.md) to seed
  department-specific personas and skills from a Git repo
- **Credential separation:** Create one Claw CR per developer
  with individual API keys for per-person cost attribution
