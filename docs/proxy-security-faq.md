# Proxy security FAQ

Common questions about the claw-operator's credential proxy:
how it protects API keys, what it can and cannot enforce, and
how far the security boundary extends.

For a high-level overview of the security model, see the
[Operator technical brief](operator-technical-brief.md).
For operator internals, see the
[claw-operator architecture docs](https://github.com/redhat-et/claw-operator/blob/main/docs/architecture.md).

## How does the proxy protect my API keys?

The gateway pod (where the AI agent runs) never holds real API
keys. All outbound HTTPS traffic is routed through a separate
proxy pod via `HTTP_PROXY`/`HTTPS_PROXY` environment variables.
The proxy performs TLS interception (MITM), strips any
authentication headers the agent might have set, and injects the
real credentials from Kubernetes Secrets before forwarding the
request upstream.

The flow for every outbound request:

1. Agent makes an HTTPS request (e.g., to `api.openai.com`)
2. The HTTP client sends a `CONNECT` request to the proxy
3. Proxy looks up the domain in its route table
4. If unknown domain: **403 Forbidden**
5. If known: proxy terminates TLS, strips all auth headers, injects
   the real credential, re-encrypts, and forwards upstream

The credential values exist only in the proxy pod's environment
variables (mounted via Kubernetes `secretKeyRef`) or volume mounts
(for GCP service account JSON and kubeconfig files). The gateway
pod has no access to the proxy pod's filesystem or process
environment.

## Can a malicious agent or skill bypass the proxy?

Not when NetworkPolicy is enforced by the cluster's CNI plugin,
which is the case on any standard OpenShift or Kubernetes cluster
with a conformant CNI (Calico, OVN-Kubernetes, Cilium, etc.).

The `HTTP_PROXY` environment variable is the cooperative
mechanism — it tells well-behaved HTTP clients to route through
the proxy. A process running inside the container could
technically unset it or make direct TCP connections.

But the real enforcement comes from **Kubernetes NetworkPolicy**,
not the environment variable. The gateway pod's egress
NetworkPolicy restricts it to exactly two destinations:

- The proxy pod on port 8080
- DNS (ports 53/5353)

All other egress is blocked at the CNI level (Calico, OVN, or
whichever CNI plugin the cluster runs). Even if a skill unsets
`HTTP_PROXY` and tries to connect directly to `api.openai.com:443`,
the kernel drops the connection. Only the proxy pod has egress to
port 443.

| Bypass attempt | Outcome |
| --- | --- |
| Unset `HTTP_PROXY` | All HTTPS calls fail (NetworkPolicy blocks direct 443) |
| Set `HTTP_PROXY` to a rogue host | Connection dropped (egress only to `claw-proxy:8080`) |
| Talk to proxy but request unauthorized domain | Proxy returns 403 |
| Read proxy's environment variables | Blocked by pod-level process isolation |

## Can the agent reach the proxy's credentials via `/proc`?

No. Containers in different pods have fully isolated process
namespaces. The `/proc` filesystem inside the gateway container
only shows the gateway's own processes. The proxy runs in a
separate pod with its own kernel namespaces, so its
`/proc/<pid>/environ` is invisible to the gateway.

This is the primary reason the proxy runs as a separate pod rather
than a sidecar container (see below).

## Why is the proxy a separate pod instead of a sidecar?

This is a deliberate architectural choice driven by security
requirements:

**NetworkPolicy granularity.** Kubernetes NetworkPolicy operates
at the pod level, not the container level. If the proxy were a
sidecar in the same pod as the gateway, you couldn't write a
policy that says "the gateway can't reach port 443 but the proxy
can." Both containers would share the same network namespace and
egress rules, so the agent could connect to external APIs directly,
bypassing the proxy entirely.

**Process isolation.** Containers in the same pod can potentially
see each other's processes (depending on the `shareProcessNamespace`
setting, which defaults to false but is a weaker boundary than
separate pods). Separate pods provide kernel-level namespace
isolation.

**Independent security contexts.** The proxy runs with
`readOnlyRootFilesystem: true`, while the gateway cannot (Node.js
and AI tools need writable paths). Separate pods let each have the
tightest feasible security profile without compromise.

**Independent lifecycle.** Updating proxy config (new credentials)
only restarts the proxy pod. The gateway pod — which holds user
state on a PVC — is unaffected. Resource limits are also
independent: the proxy needs 64-256 MiB while the gateway needs
1-4 GiB.

The trade-off is an additional pod-to-pod network hop on every API
call and more resources to manage. For a system where the workload
is untrusted code execution, the security isolation outweighs the
operational convenience of a sidecar.

## Can multiple Claw instances share one proxy?

Not with the current design. Each Claw instance gets its own proxy
Deployment, Service, ConfigMap, CA Secret, and NetworkPolicies. The
reasons:

- **Credential isolation.** Credentials are mounted as environment
  variables in the proxy pod. A shared proxy would expose instance
  A's API keys to instance B's traffic.
- **Route table conflicts.** The proxy config is a flat
  domain-to-injector map. Two instances with different keys for
  the same provider (e.g., two Anthropic keys) can't coexist in
  one route table.
- **Per-instance CA.** Each instance generates its own ECDSA CA for
  TLS interception. Sharing a CA across instances widens the blast
  radius of a CA key compromise.
- **NetworkPolicy scoping.** Egress rules use instance-specific
  labels. A shared proxy would require broader label selectors,
  weakening isolation.

The overhead is roughly 64-256 MiB per proxy pod. For clusters
with many instances, a future shared-proxy mode with per-caller
credential selection (via mTLS client identity) could reduce this,
but it would trade simplicity and isolation for resource
efficiency.

## How is the MITM CA private key protected?

The operator generates a P-256 ECDSA CA certificate and private
key on first reconciliation and stores both in a Kubernetes Secret
(`{instance}-proxy-ca`). The key material is then mounted
selectively:

- **Proxy pod:** mounts the full Secret (both `ca.crt` and
  `ca.key`) because it needs the private key to generate leaf
  certificates for TLS interception.
- **Gateway pod:** mounts only `ca.crt` (via the Secret's `items`
  selector) so the Node.js process trusts the proxy's
  certificates. The private key is never exposed to the gateway.

The CA Secret is operator-managed (carries the instance label),
so the operator's informer cache retains its `.Data`. User-owned
Secrets have their `.Data` stripped from the cache as an
additional precaution.

## Does the proxy require special privileges?

No. Both the proxy and gateway pods run under the **Kubernetes
restricted Pod Security Standard** — the strictest level available.
No cluster-admin intervention is needed to deploy the workload
pods.

The proxy pod's security profile:

```yaml
automountServiceAccountToken: false # no K8s API access
securityContext:
  seccompProfile:
    type: RuntimeDefault # syscall filtering
containers:
  - securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: [ALL] # zero Linux capabilities
    ports:
      - containerPort: 8080 # unprivileged (>1024)
```

The MITM interception works entirely at the application layer: the
gateway cooperatively sends a `CONNECT` request, and the proxy
generates leaf certificates using pure Go cryptography. No packet
interception, no iptables rules, no raw sockets. This means no
`NET_RAW`, `NET_ADMIN`, or any other Linux capability is needed.

On OpenShift, both pods run under the default `restricted-v2` SCC
with a namespace-assigned UID.

The **operator itself** (the controller-manager) does need RBAC
permissions to create Deployments, Services, Secrets, ConfigMaps,
NetworkPolicies, and Routes, but these are granted via the
operator's ClusterRole, typically installed by OLM or a cluster
admin. The workload pods it creates need no special permissions.

## Can the proxy be used for non-LLM credentials?

Yes. The proxy is a general-purpose credential-injecting proxy,
not LLM-specific. Any HTTP API that uses header-based
authentication works. For example, to give the agent access to the
GitHub API with a Personal Access Token:

```yaml
spec:
  credentials:
    - name: github
      type: bearer
      domain: api.github.com
      secretRef:
        - name: github-pat
          key: token
      allowedPaths:        # optional: restrict API paths
        - /repos/
        - /user
```

The seven supported credential injection types cover most
authentication patterns:

| Type | Mechanism | Example |
| --- | --- | --- |
| `apiKey` | Custom header (e.g., `X-Api-Key`) | Google Gemini, custom APIs |
| `bearer` | `Authorization: Bearer <token>` | OpenAI, GitHub, GitLab |
| `gcp` | OAuth2 token from service account JSON | Vertex AI, GCP APIs |
| `pathToken` | Token embedded in URL path | Telegram Bot API |
| `oauth2` | Client credentials grant flow | Enterprise SSO APIs |
| `kubernetes` | Bearer token from kubeconfig | Kubernetes API servers |
| `none` | Passthrough (domain allowlist only) | npm registry, WhatsApp |

For known LLM providers (`google`, `anthropic`, `openai`, `xai`,
`openrouter`), the operator infers `type`, `domain`, and header
configuration automatically. For any other service, set `type`
and `domain` explicitly.

See [issue #63](https://github.com/redhat-et/claw-project/issues/63)
for a planned demo of GitHub API integration.

## What happens when credential injection fails?

The proxy returns **HTTP 502 Bad Gateway** with a generic error
body `{"error":"credential injection failed"}`. It never falls
through to send the request without credentials — silent
passthrough is not an option.

The error is logged with `[REDACTED]` instead of the actual error
message to prevent credential material from appearing in logs.

## Does the proxy verify upstream TLS certificates?

Yes. The default `goproxy` library ships with
`InsecureSkipVerify: true`. The operator explicitly overrides this
to enforce TLS verification against the system CA bundle (plus any
route-specific CAs, such as Kubernetes API server CAs). The
minimum TLS version is set to 1.2.

This prevents credential theft via man-in-the-middle attacks on
the path between the proxy and upstream APIs.

## What metadata does the proxy strip?

Beyond authentication headers, the proxy removes `Via` and
`X-Forwarded-For` headers from outbound requests. This prevents
leaking internal infrastructure details (pod IPs, service names)
to upstream API providers.

Authentication headers stripped before credential injection:

- `Authorization`
- `X-Api-Key`
- `X-Goog-Api-Key`
- `Proxy-Authorization`
- `Impersonate-User`, `Impersonate-Group`, `Impersonate-Uid`
- All `Impersonate-Extra-*` headers

## What is the remaining attack surface?

Even with the proxy boundary and NetworkPolicy enforcement, some
attack vectors remain:

**DNS exfiltration.** The gateway pod needs DNS access (ports
53/5353) for hostname resolution. A malicious agent could
theoretically encode data in DNS queries to exfiltrate information.
This is a low-bandwidth channel but is technically open.

**Prompt injection on allowed domains.** If the agent has access to
`api.github.com`, it can make any API call the token's scopes
allow. The `allowedPaths` field provides path-prefix filtering, but
it does not inspect request bodies. Fine-grained authorization
depends on the token's scopes and the upstream API's permission
model.

**Abuse of allowed services.** The proxy ensures the agent can only
reach configured domains, but it cannot prevent misuse of those
domains (e.g., using a GitHub PAT to create spam issues, or
sending unwanted messages via a Telegram bot token).

**Operator-managed resources.** The gateway pod cannot access
operator-managed Secrets (proxy CA, credentials), but an agent
with `type: kubernetes` credentials could potentially modify
resources in other namespaces, depending on the RBAC granted to
the kubeconfig token. The operator sanitizes the kubeconfig (strips
real tokens, swaps CAs), but the proxy still injects real tokens
for API server requests.

These are inherent to the deployment model — the operator provides
the strongest feasible network-level isolation, while
application-level authorization depends on the scopes and
permissions of the configured credentials.
