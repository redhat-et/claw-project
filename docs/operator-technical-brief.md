# Claw Operator Technical Brief

A summary of the claw-operator's architecture, security model, and
operational characteristics for teams evaluating or deploying it on
OpenShift.

## What it does

The claw-operator manages OpenClaw AI assistant instances on
OpenShift/Kubernetes. For each `Claw` custom resource, the operator
creates and manages:

- A **gateway pod** running the OpenClaw AI assistant (Node.js)
- A **MITM proxy pod** that intercepts all outbound traffic and
  injects credentials
- Supporting infrastructure: ConfigMaps, Secrets, PVCs, Services,
  Routes, NetworkPolicies, and optionally ServiceMonitors

Users interact with the assistant through a web UI exposed via an
OpenShift Route. The operator handles all infrastructure concerns
declaratively.

## Security model

The operator implements a defense-in-depth architecture with multiple
security layers.

### Credential isolation (the proxy boundary)

The gateway pod **never sees real API keys**. All outbound traffic
flows through an HTTP/HTTPS proxy (`HTTP_PROXY`/`HTTPS_PROXY` env
vars). The proxy intercepts HTTPS connections via MITM (TLS
interception) and injects credentials from Kubernetes Secrets into
outgoing requests.

Supported credential injection types:

| Type         | Mechanism                         | Example use                      |
| ------------ | --------------------------------- | -------------------------------- |
| `apiKey`     | Custom header injection           | Google Gemini (`x-goog-api-key`) |
| `bearer`     | `Authorization: Bearer` header    | OpenAI, xAI, OpenRouter          |
| `gcp`        | OAuth2 token from service account | Vertex AI                        |
| `pathToken`  | Token embedded in URL path        | Telegram Bot API                 |
| `oauth2`     | Client credentials grant          | Azure OpenAI                     |
| `kubernetes` | Bearer token from kubeconfig      | Kubernetes API access            |
| `none`       | Passthrough (no injection)        | WhatsApp, GitHub git clones      |

The gateway pod holds only placeholder tokens. The proxy replaces
them transparently before the request reaches the upstream API.

### Domain allowlisting

The proxy blocks all outbound traffic to domains not explicitly
configured. Unknown domains receive HTTP 403. This prevents the AI
assistant from reaching arbitrary internet endpoints. Allowed domains
come from:

- Credential entries in `spec.credentials`
- MCP server URLs in `spec.mcpServers` (auto-extracted)
- Web search provider domains
- Built-in passthroughs: clawhub.ai (plugin registry),
  registry.npmjs.org (npm packages), github.com (git clones),
  openrouter.ai (model pricing)

### TLS verification

The proxy verifies upstream TLS certificates using the system CA
bundle plus any route-specific CAs (e.g., Kubernetes API server CAs).
This prevents credential theft even if cluster network traffic is
compromised — an attacker cannot present a fake certificate to
intercept API keys.

The default goproxy library ships with `InsecureSkipVerify: true`.
The operator explicitly overrides this.

### Secret cache stripping

The operator's informer cache strips `.Data` from user-owned Secrets
(those without the operator's instance label). Secret payloads are
read on-demand from the API server via a dedicated `UserSecretReader`.
This minimizes the window where credential material exists in
operator process memory.

### Auth header stripping

Before credential injection, the proxy strips all known
authentication and impersonation headers from requests: `Authorization`,
`X-Api-Key`, `X-Goog-Api-Key`, `Proxy-Authorization`,
`Impersonate-User`, `Impersonate-Group`, `Impersonate-Uid`, and all
`Impersonate-Extra-*` headers. This prevents the gateway from
smuggling its own auth headers past the proxy.

### Proxy metadata removal

Outbound requests have `Via` and `X-Forwarded-For` headers stripped
to prevent leaking internal infrastructure details (pod IPs, service
names) to upstream API providers.

### Pod security

All containers run with:

- `runAsNonRoot: true` (UID 65532 or OpenShift namespace-assigned)
- `allowPrivilegeEscalation: false`
- `capabilities: drop: [ALL]`
- `seccompProfile: RuntimeDefault`
- `readOnlyRootFilesystem: true` on proxy and wait-for-proxy
  containers

### NetworkPolicy enforcement

Three NetworkPolicies per instance enforce traffic segmentation:

- **Ingress:** gateway accepts traffic only from OpenShift router
  namespaces (and optionally Prometheus monitoring)
- **Gateway egress:** gateway can only reach the proxy pod + DNS
  (and optionally in-cluster services when `inClusterBypass` is
  enabled)
- **Proxy egress:** proxy can reach HTTPS (port 443) + DNS + any
  non-standard ports from kubernetes credentials or MCP servers

### Sanitized kubeconfig

When a `type: kubernetes` credential provides cluster access, the
operator:

1. Validates that only token-based auth is used (rejects client
   certs, exec plugins, basic auth)
2. Creates a sanitized copy with tokens replaced by placeholders
   and cluster CAs replaced by the proxy CA
3. Mounts the sanitized kubeconfig on the gateway pod
4. The proxy intercepts API server requests and injects real tokens

The gateway never holds real cluster tokens.

## Reconciliation architecture

The operator uses a three-phase reconciliation pattern:

**Phase 1 — Credentials and proxy config:** Resolve all credentials,
generate the proxy configuration, create the proxy CA certificate,
and apply proxy-specific resources.

**Phase 2 — Route and host resolution:** Apply the OpenShift Route,
then read back its `.status.ingress[0].host`. If the router hasn't
populated the host yet, requeue with 5-second backoff. On vanilla
Kubernetes (no Route CRD), fall back to `http://localhost:18789`.

**Phase 3 — ConfigMap enrichment and remaining resources:** With the
Route host known, inject it into the gateway ConfigMap for CORS
configuration, then apply all remaining resources.

This ordering exists because the Route host (assigned asynchronously
by the OpenShift router) must be injected into the ConfigMap's
`gateway.controlUi.allowedOrigins` for CORS to work.

### Deployment apply strategy

Deployments use `controllerutil.CreateOrUpdate` instead of
server-side apply (SSA). SSA causes `generation` to increment on
every patch due to field-ownership transfers between the operator
and `kube-controller-manager`, triggering unnecessary pod rollouts.
A `NormalizeDeployment()` function pre-applies Kubernetes admission
defaults to prevent spurious diffs.

## Multi-instance support

Multiple Claw instances can run in the same namespace. Resource
names use the Claw CR name as a prefix (e.g., `instance-proxy`,
`instance-config`). An instance label
(`claw.sandbox.redhat.com/instance`) is injected into all resource
metadata, Deployment selectors, Service selectors, and NetworkPolicy
selectors to ensure isolation.

## Provider system

The `knownProviders` registry centralizes all per-provider
configuration. Adding a new first-class LLM provider requires a
single map entry. Known providers (google, anthropic, openai, xai,
openrouter) get automatic type inference, domain defaults, wire
format routing, model catalogs, and companion provider generation.

### Vertex AI SDK path

For non-Google providers on Vertex AI (e.g., Anthropic on Vertex),
the operator:

1. Creates a stub ADC (Application Default Credentials) ConfigMap
   with fake credentials
2. Auto-installs the required plugin
   (`@openclaw/anthropic-vertex-provider`)
3. The proxy intercepts Google SDK token refresh requests and returns
   dummy tokens
4. Real GCP tokens are injected by the proxy on actual API calls

### Custom providers

`spec.customProviders` supports self-hosted models (vLLM, Ollama,
TGI) and hosted providers not in the built-in catalog. Each entry
declares baseUrl, wire format, credential reference, and model list.

## Channel integrations

Known messaging channels (Telegram, Discord, Slack, WhatsApp) get
automatic proxy configuration including companion domain routes.
Users specify `channel: telegram` with a Secret reference; the
operator infers credential type, domain, path token config, and
channel enablement.

## Observability

- **Prometheus metrics:** `claw_instance_status` (gauge per
  ready/provisioning/failed) and `claw_instance_info` (metadata
  labels) are registered on the operator's metrics endpoint
- **OTel Collector sidecar:** optional sidecar that receives OTLP
  metrics from the gateway and exports Prometheus format
- **ServiceMonitor:** auto-created when metrics are enabled
  (gracefully skipped if CRD is not installed)

## Config management

The operator uses a three-tier config enrichment model:

| Tier         | Behavior                                 | Examples                                               |
| ------------ | ---------------------------------------- | ------------------------------------------------------ |
| Always-win   | Operator sets unconditionally            | gateway.port, models.providers, channels               |
| Append/merge | Operator provides base, user adds on top | allowedOrigins, trustedProxies, model catalog          |
| User-only    | Operator never touches                   | diagnostics, plugins (non-declared), cron, UI settings |

User customization via `spec.config.raw` is deep-merged into the
operator's base config. A `merge.js` init container script handles
the merge at pod startup, preserving user's runtime changes
(model selection, plugin installs) across restarts.

## Idle mode

Setting `spec.idle: true` scales all managed Deployments to zero
replicas. Setting it back to `false` triggers a full reconcile that
restores the instance. Useful for cost management on shared clusters.

## Version coupling

The OpenClaw container image version is embedded in the operator
binary. Upgrading OpenClaw requires rebuilding the operator because
the operator makes ~40 assumptions about OpenClaw's config schema,
file paths, CLI commands, wire format identifiers, and container
internals. See `openclaw-version-coupling.md` for the full
coupling surface analysis.
