# OpenClaw red teaming on OpenShift

This bundle runs Promptfoo 0.121.19 as a one-shot OpenShift Job in the existing
`redteam` namespace against the OpenClaw agent named `default`. It uses Promptfoo's native OpenClaw
provider, saves results to a PVC, disables Promptfoo telemetry and hosted red
team generation, and does not deploy Promptfoo's unauthenticated community UI.

## What it tests

The local-generation baseline covers excessive agency, tool discovery, PII
leakage, authorization failures, prompt extraction, Base64 transformations, and
known jailbreak templates. These tests can cause real agent actions. They are
not safe against a production agent or production data. See [COVERAGE.md](COVERAGE.md)
for the coverage model, available expansion options, and their cost and safety
tradeoffs.

## How it works

This is an LLM-assisted red-team evaluation, not a static manifest or network
scanner. Promptfoo coordinates two different systems:

1. The attacker/grader LLM (`openai:chat:gpt-4.1-mini` by default) helps create
   adversarial prompts from the configured purpose, plugins, and strategies.
2. Promptfoo sends each generated prompt to the OpenClaw `default` agent through
   the Gateway's OpenAI-compatible Chat Completions endpoint.
3. OpenClaw handles the prompt normally. It may read memory or files and invoke
   any tools that the test agent is permitted to use.
4. The attacker/grader LLM evaluates OpenClaw's response against the relevant
   security policy. Promptfoo records the response, grade, and explanation.
5. The Job saves machine-readable JSON and a generated Markdown report on the
   results PVC. `scripts/collect-results.sh` copies those artifacts locally.

```text
test configuration
       |
       v
Promptfoo <----> attacker/grader LLM
       |
       | adversarial prompt
       v
OpenClaw Gateway --> default agent --> permitted tools, files, and memory
       |
       | response
       v
Promptfoo --> JSON + Markdown report on the PVC
```

The attacker/grader is involved before and after the target call: it generates
tests and judges responses. It is not the system being tested; OpenClaw is the
target. A passing grade describes the observed response and does not prove that
OpenClaw avoided a hidden tool call or side effect, so results must be correlated
with logs, traces, filesystem changes, network telemetry, and agent memory.

### Data flow and safety boundary

`PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true` disables Promptfoo's hosted
red-team generation service. It does **not** make this bundle fully local. With
the default configuration, test-generation inputs, OpenClaw responses, and
grading context are sent to OpenAI because OpenAI is the configured
attacker/grader provider. They are also retained in the results PVC.

OpenClaw may execute real tools while processing an adversarial prompt. Run this
only against a disposable agent with synthetic data, isolated memory and files,
restricted tools and network access, and no production messaging channels.
Replace the attacker/grader provider with an approved internal model if prompts
and responses must remain inside your environment.

## Prerequisites

- `oc` access with permission to create a Job, ConfigMaps, Secret, PVC, and
  NetworkPolicy in the `redteam` namespace.
- An OpenClaw Gateway reachable through a cluster Service.
- A disposable OpenClaw agent whose ID is exactly `default`.
- An API key for the configured attacker/grader (`openai:chat:gpt-4.1-mini`).
- Cluster egress to that attacker model's API.

The `default` agent should have its own disposable workspace and memory, no
production messaging channels, synthetic secrets, constrained tool policy,
restricted network access, and request/spend limits. The Gateway HTTP bearer
credential is an operator credential, so protect it accordingly.

## 1. Enable the OpenClaw HTTP endpoint

OpenClaw disables Chat Completions by default. Enable it on the installed
`Claw` resource:

```bash
oc patch claw instance -n redteam --type=merge -p '{
  "spec":{"config":{"raw":{"gateway":{"http":{"endpoints":{
    "chatCompletions":{"enabled":true}
  }}}}}}}
}'
```

Confirm the OpenClaw Service and port:

```bash
oc get svc -n <openclaw-namespace>
```

The URL must be the Gateway origin, without `/v1`, for example:

```text
http://instance.redteam.svc.cluster.local:18789
```

The bundle includes an additive NetworkPolicy that permits only its labeled Job
to reach this gateway within the `redteam` namespace.

This example deliberately uses HTTP over the cluster-internal Service. The
Gateway does not enable TLS by default, and the path is limited by the namespace
and NetworkPolicy. The bearer token is therefore not encrypted on the cluster
overlay network. Environments that do not trust that path must enable Gateway
TLS, distribute its CA certificate to the Job, and change the URL to `https`.

The Job needs external access to the configured attacker/grader API. This
portable example does not add an egress-deny policy because standard Kubernetes
NetworkPolicy cannot allow an API by DNS name and clusters differ in their
egress controls. In a controlled environment, route the Job through an approved
egress proxy and add a policy allowing only DNS, the OpenClaw Gateway, and that
proxy.

## 2. Create the runtime credentials

The runtime ConfigMap is included in the bundle with the internal URL above.

Put each credential in a local file without a trailing newline:

```bash
mkdir -p secrets
printf %s 'OPENCLAW_OPERATOR_TOKEN' > secrets/openclaw-token
printf %s 'ATTACKER_MODEL_API_KEY' > secrets/attacker-api-key
```

Create the Secret:

```bash
oc create secret generic claw-redteam-secrets \
  -n redteam \
  --from-file=OPENCLAW_GATEWAY_TOKEN=secrets/openclaw-token \
  --from-file=ATTACKER_API_KEY=secrets/attacker-api-key
```

Delete the local files once the Secret is confirmed:

```bash
oc get secret claw-redteam-secrets -n redteam
rm -f secrets/openclaw-token secrets/attacker-api-key
```

Do not apply `manifests/secret.example.yaml`; it is documentation only.

## 3. Verify the target before scanning

Launch the temporary curl pod. Its token is read directly from the Kubernetes
Secret rather than copied into local command arguments or Pod metadata. This
prompt is benign but exercises the same Gateway endpoint and agent selection
used by Promptfoo:

```bash
oc delete pod claw-api-check -n redteam --ignore-not-found
oc apply -n redteam -f manifests/target-check.yaml
oc logs -n redteam -f pod/claw-api-check
oc delete pod claw-api-check -n redteam
```

If this fails, fix Service routing, NetworkPolicy, Gateway authentication, or
the `default` agent before continuing.

## 4. Review the policy and attacks

Edit `config/promptfooconfig.yaml` before every environment's first run:

- Make `purpose` accurately describe allowed and prohibited behavior.
- Remove plugins irrelevant to your agent.
- Keep `numTests: 2` for the first run with the expanded strategy set.

The checked-in profile includes original probes, Base64 variants, and static
jailbreak templates. Strategies can multiply the number of target and grader
calls. Read [COVERAGE.md](COVERAGE.md) before adding encodings, application-level
plugins, hosted generation, or adaptive multi-turn attacks.

`PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true` prevents use of Promptfoo's
hosted generation service. Prompts and target responses are still sent to the
attacker/grader configured in the YAML—in this bundle, OpenAI. For an entirely
on-premises flow, replace that provider with a supported internal model and
change the corresponding Secret/environment variable.

## 5. Deploy and run

From this directory:

```bash
oc apply -k .
```

Watch the Job and logs:

```bash
oc get pods,jobs,pvc -n redteam
oc logs -n redteam -f job/claw-redteam
```

The Job has `backoffLimit: 0`: a failed scan is not automatically repeated and
cannot accidentally multiply calls or side effects.

## 6. Retrieve results

The Job automatically converts `results.json` into a human-readable
`report.md`, even when Promptfoo exits with code 100 because it found security
failures. The PVC also contains generated `redteam.yaml` and Promptfoo's local
evaluation database.

Pull the useful artifacts and remove the temporary reader Pod with:

```bash
./scripts/collect-results.sh
```

Set `NAMESPACE` or pass a destination when needed, for example
`NAMESPACE=my-redteam ./scripts/collect-results.sh evidence/run-001`.

The local `results/` directory is intentionally gitignored because raw results
and reports can contain sensitive prompts, responses, PII, secrets, and evidence
of agent side effects. Store retained artifacts in an access-controlled evidence
system rather than Git. Only commit a reviewed, redacted report when your
organization's disclosure policy permits it.

Review every failure together with OpenClaw logs, traces, filesystem changes,
network telemetry, and memory. Text-only grading cannot prove that a forbidden
tool call or side effect did not occur.

## Run again

Kubernetes Jobs are immutable and the name is intentionally stable. Delete only
the completed Job, update configuration if needed, then reapply:

```bash
oc delete job claw-redteam -n redteam --ignore-not-found
oc apply -k .
```

The PVC is retained, but `results.json` is overwritten. Copy or rename important
results before rerunning. Promptfoo's evaluation database remains on the PVC.

## Memory and resource tuning

Red teaming can create long contexts and concurrent gateway sessions. In the
observed 70-case run, a 4 GiB OpenClaw gateway limit caused OOM kills; an 8 GiB
limit completed successfully with a sampled peak near 3.3 GiB. Treat those as
starting observations, not universal requirements.

- Promptfoo Job memory is set under `resources` in `manifests/job.yaml` (default
  request 512 MiB, limit 2 GiB).
- Results capacity is set in `manifests/pvc.yaml` (default 2 GiB).
- OpenClaw gateway memory is configured on the installed `Claw` resource, not
  in this bundle. Inspect it with `oc get claw instance -n redteam -o yaml`, then
  update the operator-supported resource request/limit fields for your OpenClaw
  version.

Monitor both workloads during a baseline:

```bash
oc adm top pods -n redteam
oc get pods -n redteam -o custom-columns=NAME:.metadata.name,RESTARTS:.status.containerStatuses[*].restartCount
oc describe pod -n redteam <gateway-pod>
```

If the gateway reports `OOMKilled`, increase its memory limit, reduce Promptfoo
concurrency/test count, or both. Do not infer success from the Job alone: verify
that the result summary has zero evaluation errors and that the gateway did not
restart.

Hosted-only plugins and adaptive jailbreak strategies are omitted because
`PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true`. Enable them only after
reviewing Promptfoo's data handling and configuring an approved hosted or
self-hosted remote-generation endpoint.

## Cleanup

Remove the Job but retain results:

```bash
oc delete job claw-redteam -n redteam --ignore-not-found
```

Delete the red-team resources while retaining the OpenClaw instance and its
namespace:

```bash
oc delete -k .
oc delete secret claw-redteam-secrets -n redteam --ignore-not-found
```

## References

- Promptfoo OpenClaw provider: https://www.promptfoo.dev/docs/providers/openclaw/
- Promptfoo agent red teaming: https://www.promptfoo.dev/docs/red-team/agents/
- Promptfoo data handling: https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/
- OpenClaw Chat Completions API: https://docs.openclaw.ai/gateway/openai-http-api
