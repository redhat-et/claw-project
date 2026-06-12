# Configuring OpenClaw for Business Users

Configuration strategies for deploying preconfigured, locked-down
OpenClaw instances for business users (HR, sales, executive
assistants) on OpenShift. Covers config layering, tool policies,
skill management, and network boundaries.

## Config delivery and layering

Symlinked openclaw.json layouts are unsupported for OpenClaw-owned
writes — an atomic write may replace the path instead of preserving
the symlink. ConfigMap mounts in OpenShift are symlinks, so don't
mount the config directly. Have your operator render the config and
copy it into a writable location (emptyDir or the user's PVC) via
an initContainer, with `OPENCLAW_CONFIG_PATH` pointing at the real
file.

Also decide whether users may mutate config at all — the Control UI
and `config.apply`/`config.patch` RPCs can rewrite it, so for
business users you probably want the operator to be the single
source of truth and reconcile drift.

The `$include` mechanism maps nicely to your operator: a base layer
(gateway, providers, security), a role layer (HR, EA, sales persona
+ skills), and a per-user layer (identity, channel allowlist). Your
CRD could mirror exactly those three layers.

## Per-role agent definition

- `agents.list[]` / `agents.defaults`: name, role description, and
  the workspace bootstrap files (AGENTS.md, SOUL.md, etc.) that
  define the persona. For HR vs. sales, most of the differentiation
  lives here and in the skill set, not in code.
- `model.primary` plus fallbacks per role — point providers at your
  internal model gateway (LiteLLM/vLLM/MaaS) via a custom provider
  `baseUrl`, so no per-user API keys ever exist. Keep credentials
  in auth-profiles.json rather than inline in openclaw.json, since
  the gateway rejects inline keys in some sections — operator
  renders that from a Secret.

## Tool policy — the most important knob

If `tools.allow` is non-empty, everything else is treated as
blocked, and tool policy is the hard stop — `/exec` cannot override
a denied exec tool. For business users start from a tight allowlist
(read, web_search maybe, the messaging tools) and explicitly deny
`exec`, `browser`, `gateway`, `nodes`, `cron`, `sessions_spawn`.

Note the layering: agent-level tools.allow/deny, sandbox-level tool
filter, and sandbox network access are three separate gates. On
OpenShift you likely won't use OpenClaw's Docker sandbox at all (no
Docker socket under restricted SCC, and DinD is ugly) — your pod
*is* the sandbox. So the per-agent tool policy plus
Kubernetes-level controls carry the weight.

## Skills: allowlist + install policy + immutability

Three complementary mechanisms:

1. `agents.list[].skills` is the explicit final skill set per agent
   (it doesn't merge with defaults), and `allowBundled` restricts
   which bundled skills are eligible — so each role gets a closed
   list.
1. `security.installPolicy` runs a trusted command after OpenClaw
   stages source material and before install continues. Applies to
   ClawHub skills, uploaded skills, Git/local skills, dependency
   installers, and plugins. The policy receives the origin (registry
   URL, slug, version) as JSON, so you can write a small Go binary
   that blocks anything whose `origin.registry` isn't your internal
   registry, or simply blocks all installs.
1. The strongest option: bake approved skills into the image (or
   mount them read-only from a ConfigMap/PVC into a skill root) and
   don't grant install capability at all. Treat skills like any
   other artifact in your supply chain.

Treat app-level skill config as policy, not enforcement.

## Network egress as the real boundary

Everything above is application config, and a compromised or
confused agent can't be trusted to honor it. The hard boundary
should be an OpenShift NetworkPolicy (or egress firewall) per
namespace/pod: allow the model gateway, your internal skill
registry, and the specific SaaS APIs each role needs (HRIS for HR,
CRM for sales), deny everything else — including clawhub.com.

The AuthBridge pattern fits here too: inject credentials for
approved upstreams at the sidecar so the agent instance never holds
long-lived tokens.

## Gateway and channel access

- `gateway.bind` to loopback inside the pod, fronted by your own
  proxy/Route with SSO — non-loopback binding without authentication
  is rejected at startup, but you don't want OpenClaw's token auth
  as your perimeter anyway. An oauth-proxy sidecar against your
  Keycloak is the natural fit.
- Channels: if you expose Slack/Teams/Telegram, pin `dmPolicy` to
  allowlist with `allowFrom` set to exactly that one user's identity,
  rendered by the operator from your IdP.

## A few more parameters worth deciding per instance

- Disable or restrict `crons`, `hooks`, and plugin installs unless
  a role genuinely needs automation.
- Pin the OpenClaw version in the image and block the `update.run`
  RPC path — self-updating agents and GitOps don't mix.
- Persistence: a small PVC per user for workspace + memory, so the
  agent accumulates role-specific context across sessions (that's a
  big part of the "preconfigured, low-friction" value).
- `agents.defaults.maxConcurrent` and gateway rate limits, since
  you're multiplying instances on shared cluster capacity.

The key design question is how much you let a role preset express
versus locking it in the operator. See
[Enterprise Deployment Design](enterprise-deployment-design.md)
for the proposed CRD features that address these concerns.
