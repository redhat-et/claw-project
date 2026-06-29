# Claw project progress report

**Period:** June 9 -- 29, 2026 (3 weeks)

**Repositories:**

| Repository | Role |
| ---------- | ---- |
| [claw-project][] | Umbrella: documentation, scenario walkthroughs, presentations |
| [claw-operator][] | Kubernetes operator (fork with enterprise extensions) |
| [claw-collections][] | Deployable manifests and enterprise profiles |
| [claw-operator-extras][] | Deployer web UI for OpenShift |

[claw-project]: https://github.com/redhat-et/claw-project
[claw-operator]: https://github.com/redhat-et/claw-operator
[claw-collections]: https://github.com/redhat-et/claw-collections
[claw-operator-extras]: https://github.com/redhat-et/claw-operator-extras

---

## 1. CRD extensions

These extend the upstream spec without breaking backward
compatibility — all additions are optional, and existing
manifests continue to work unchanged. The 26-commit diff
(+7,400 / -2,700 lines across 57 files) breaks down into
the following groups.

### Entirely new CRD fields (not in upstream)

| CRD field | Purpose | PR |
| --------- | ------- | -- |
| `spec.version` | Pin the OpenClaw image tag per instance (e.g., `"2026.6.8"`) | [#1][op1] |
| `spec.agentFiles` | Seed workspace files from a Git repo or ConfigMap archive, with apply policy and read-only mounts | [#4][op4], [#8][op8], [#16][op16] |
| `spec.config.management: user` | User-managed mode — operator seeds config once, then preserves runtime edits | [#4][op4] |
| `spec.restrictions` | Runtime restriction controls (persona guard, plugin lockdown) | [#7][op7] |
| `spec.serviceAccountName` | Assign a Kubernetes ServiceAccount to the gateway pod | commit `9ef4e22` |
| `status.lastDeployedVersion` | Track last deployed version; detect downgrades | commit `36ebd63` |
| Status conditions: `PluginCompatibility`, `VersionDowngrade`, `InitContainerFailure` | Surface operational warnings | commit `36ebd63` |

### Modified upstream CRD fields

| CRD field | Upstream has | We changed | PR |
| --------- | ----------- | ---------- | -- |
| `spec.network` | `inClusterBypass`, `additionalEgress` | Added `builtinPassthroughs` — allowlist which builtin proxy domains are reachable | [#5][op5] |
| `spec.skills` | `map[string]string` (inline only) | Restructured to `SkillsSpec` with three channels: inline content, OCI images, ConfigMap refs; added `imagePullSecrets` | [#18][op18], [#28][op28] |

[op1]: https://github.com/redhat-et/claw-operator/pull/1
[op4]: https://github.com/redhat-et/claw-operator/pull/4
[op5]: https://github.com/redhat-et/claw-operator/pull/5
[op7]: https://github.com/redhat-et/claw-operator/pull/7
[op8]: https://github.com/redhat-et/claw-operator/pull/8
[op16]: https://github.com/redhat-et/claw-operator/pull/16
[op18]: https://github.com/redhat-et/claw-operator/pull/18
[op28]: https://github.com/redhat-et/claw-operator/pull/28

### Design rationale

The extensions follow one principle: **everything that an
enterprise admin needs to control should be declarative in the
CR, not manual configuration inside the pod.** Version pinning,
network lockdown, filesystem protection, and skill delivery are
all things that would otherwise require SSH-into-pod workflows
or custom init containers.

---

## 2. Isolation/lockdown scenario spectrum

We defined six deployment scenarios (A through F) that form a
spectrum from open to fully locked down. Each scenario has a
walkthrough in claw-project and a deployable manifest in
claw-collections.

| Scenario | Name | Key controls |
| -------- | ---- | ------------ |
| **D** | Personal assistant | Minimal CR, single provider, no restrictions |
| **A** | Shared team | Shared URL, multi-provider, seeded profile from Git |
| **C** | Registry lockdown | Per-user instances, `builtinPassthroughs` blocks npm/ClawHub/OpenRouter, internal mirror only |
| **D+** | Power user | User-managed mode (`config.management: user`), full runtime control |
| **F** | Locked-down kiosk | Five defense layers: read-only persona, blocked plugins, blocked passthroughs, filesystem protection, network policy |
| **GitHub** | Project assistant | Proxy used for non-LLM API (GitHub REST), fine-grained PAT, read-only advisor |

### Defense-in-depth layers (Scenario F)

Scenario F demonstrates the full lockdown stack:

1. **Persona guard** — SOUL.md mounted read-only via
   `agentFiles.readOnly`, agent cannot modify its own
   instructions
2. **Plugin lockdown** — `restrictions.pluginInstallation:
   false` prevents runtime plugin installation
3. **Registry lockdown** — `builtinPassthroughs: []` blocks
   all builtin domains (npm, ClawHub, OpenRouter)
4. **Filesystem protection** — critical workspace files on
   read-only mounts
5. **Network policy** — only the proxy and the LLM provider
   are reachable

### Documentation

Each scenario has:

- A **walkthrough** in `docs/scenarios/` (claw-project) with
  a story, prerequisites, step-by-step instructions, and
  verification commands
- A **deployable manifest** in `manifests/scenarios/`
  (claw-collections) that can be applied directly or used as
  a GitOps template
- An **enterprise profile** in `enterprise-profiles/`
  (claw-collections) with preconfigured `openclaw.json` and
  workspace files (SOUL.md, AGENTS.md, TOOLS.md)

---

## 3. Claw-as-Code: GitOps deployment via Argo CD

We built a complete GitOps workflow for deploying OpenClaw
instances declaratively through Git, using OpenShift GitOps
(Argo CD).

### How it works

1. **claw-collections** repository is the source of truth
2. Each user gets a subdirectory under `manifests/<username>/`
3. An **ApplicationSet** with a Git directory generator creates
   one Argo CD Application per directory
4. Each directory maps to a `<username>-claw` namespace
   (created automatically)
5. Argo CD syncs with `selfHeal: true` — manual cluster edits
   are reverted to match Git

### What we delivered

- **GitOps setup guide** (`docs/gitops-setup.md`) — full
  admin and user walkthrough, including RBAC, ApplicationSet
  template, and onboarding steps for each provider type
- **Resource tracking** — how to trace a Claw resource back
  to its Git source file via Argo CD tracking annotations
- **Claws-as-Code slide deck** (`docs/presentations/`) —
  presentation covering the GitOps workflow and scenario
  spectrum
- **Per-user directory structure** in claw-collections with
  working manifests for multiple users

### User workflow

A new user creates a directory, writes a YAML file, and pushes:

```text
manifests/
  panni/
    claw-vertex-claude-assistant.yaml
    claw-vertex-claude-financial.yaml
  dylan/
    claw-openai-assistant.yaml
```

Argo CD picks up the change within 5 minutes. The admin creates
the LLM provider secret whenever ready — the operator does not
crash on missing secrets; the instance simply stays not-Ready
until the secret exists.

---

## 4. Skill delivery system

We restructured `spec.skills` to support three delivery
channels, enabling enterprise skill distribution without
requiring internet access from the agent pod.

| Channel | Source | Use case |
| ------- | ------ | -------- |
| `content` | Inline in the CR | Small, operator-managed skills |
| `images` | OCI image (Kubernetes ImageVolume) | Versioned skill packages from a registry; supports `imagePullSecrets` for private registries |
| `configMaps` | ConfigMap keys | Skills managed by other tools (Helm, Kustomize) |

OCI skill images are mounted read-only at
`workspace/skills/<name>/`. This requires Kubernetes 1.31+
with the ImageVolume feature gate. The sibling project
[skillimage][] provides tooling for packaging skills as OCI
images.

[skillimage]: https://github.com/redhat-et/skillimage

---

## 5. Deployer web UI

The **claw-operator-extras** repository contains a web-based
deployer application for OpenShift that lets users create and
manage Claw instances without writing YAML.

### Recent work (Isaiah Stapleton + team)

| Date | Change |
| ---- | ------ |
| Jun 9 | Initial deployer implementation |
| Jun 11 | Dashboard updates and deployer fixes |
| Jun 17 | PatternFly/OpenShift-styled UI rebuild |
| Jun 17 | Dashboard rewired to new layout |
| Jun 18 | List instances across all projects, preserve user-chosen names |
| Jun 18--19 | CI: automated image builds, lint checks |
| Jun 25 | Removed admin dashboard; simplified to deployer-only |

The deployer talks to the Kubernetes API to create `Claw`
resources — it depends only on the
`claw.sandbox.redhat.com/v1alpha1` API shape, not on operator
internals.

---

## 6. Enterprise profiles

Seven preconfigured enterprise profiles in claw-collections,
each containing an `openclaw.json` and workspace files
(SOUL.md, AGENTS.md, TOOLS.md) tailored to a specific role:

| Profile | Target persona |
| ------- | -------------- |
| `executive-assistant` | C-suite strategic advisor |
| `financial-analyst` | Regulated financial analysis |
| `hr-specialist` | HR policy and compliance |
| `marketing-specialist` | Marketing content and strategy |
| `project-assistant` | GitHub-aware project planning |
| `shared-team` | Multi-developer team assistant |
| `standard-user` | General-purpose locked-down user |

Profiles are referenced from Claw manifests via
`agentFiles.git.path`, so a single Git repo serves as both
the deployment source (manifests) and the profile library.

---

## 7. Documentation and operational guides

| Document | Location | Purpose |
| -------- | -------- | ------- |
| Operations guide | `docs/operations-guide.md` | Production practices index |
| Proxy security FAQ | `docs/proxy-security-faq.md` | How the MITM proxy protects API keys |
| Git change tracking | `docs/git-change-tracking.md` | Audit trail for agent workspace edits |
| GitOps setup guide | `docs/gitops-setup.md` | Argo CD deployment walkthrough |
| 4 scenario walkthroughs | `docs/scenarios/` | Step-by-step guides for scenarios A, C, F, and GitHub |
| Claws-as-Code deck | `docs/presentations/` | Slide presentation for the GitOps workflow |

---

## 8. CI/CD

- **claw-operator:** unified GitHub Actions workflow combining
  kind cluster tests and image publishing; added skill
  validation to the test suite
- **claw-operator-extras:** automated image builds and
  deployment workflow, basic lint checks

---

## Summary by week

### Week 1 (Jun 9--15)

- CRD foundations: `spec.version`, `builtinPassthroughs`,
  user-managed mode, private Git repos, restrictions
- Initial deployer app and claw-collections repository
- Enterprise onboarding workflows document

### Week 2 (Jun 16--22)

- Filesystem protection: `agentFiles.readOnly`
- Skill delivery restructure (OCI images, ConfigMaps)
- GitOps setup guide and Argo CD integration
- All scenario walkthroughs (A, C, D, F)
- Enterprise profiles (7 roles)
- Deployer UI rebuilt with PatternFly

### Week 3 (Jun 23--29)

- `imagePullSecrets` for private OCI skill registries
- `serviceAccountName` for gateway pods
- GitHub-aware project assistant walkthrough
- Proxy security FAQ and operations guide
- Claws-as-Code slide deck
- Deployer cleanup (removed admin dashboard)

---

## What's next (Jul -- mid-Jul draft plan)

### Demo and validation (carry-over)

- Demo deployment scenarios A through F on OpenShift
  (targeting early July)
- Validate the full GitOps flow end-to-end with multiple
  users on a shared cluster
- Upstream discussion on which CRD extensions to propose
  for merge

### Observability

Stand up a production-grade observability stack so admins
and users can see what their agents are doing.
([#4][cp4], [#43][cp43], [#44][cp44])

| Work item | Description |
| --------- | ----------- |
| OpenShift Observability integration | Deploy Cluster Observability Operator + Red Hat build of OpenTelemetry; work with the Observability team for initial setup |
| User dashboard | Per-user view of owned Claw instances — status, token usage, cost attribution |
| Admin dashboard | Cluster-wide view across all namespaces |
| TLS on controller metrics | Enable service-CA-signed TLS on the operator's Prometheus endpoint ([#43][cp43]) |
| Structured audit events | Emit audit trail for CRD mutations and credential changes ([#44][cp44]) |

### Secrets and identity management

Move from `oc create secret` to enterprise-grade credential
workflows. ([#2][cp2], [#45][cp45], [#46][cp46])

| Work item | Description |
| --------- | ----------- |
| Sealed Secrets for GitOps | Add SealedSecret manifests to claw-collections so LLM provider keys can be committed alongside Claw CRs; lightweight first step for teams not ready for Vault |
| External Secrets Operator integration | Document and test ESO with Vault and AWS Secrets Manager backends ([#45][cp45]) |
| HashiCorp Vault PoC | Build on [sallyom/claw-vault-openshift][vault-poc]; Vault with Kubernetes Auth for self-service secret provisioning ([#2][cp2]) |
| Per-namespace RBAC scoping | Scope Secret access to per-namespace Roles; document multi-tenancy boundaries ([#46][cp46]) |
| `serviceAccountName` + Workload Identity | Use the new SA field with GCP Workload Identity / AWS IRSA to eliminate static SA keys |

[vault-poc]: https://github.com/sallyom/claw-vault-openshift

### Ingress channels

Messaging platforms where users talk *to* the agent. The
CRD already supports `channel` with known values: telegram,
discord, slack, whatsapp.

| Work item | Description |
| --------- | ----------- |
| Discord channel (in progress) | Team member actively integrating Discord; validate bot token injection and `channelConfig` |
| Slack channel | Add Slack Socket Mode support; multi-secret credential flow (botToken + appToken with `role` field) |
| WebSocket proxy injection | Inject channel tokens via proxy MITM instead of gateway env vars to preserve the security boundary ([claw-operator#32][co32]) |

### Egress integrations

External services the agent talks *to* through the proxy.
These follow the same pattern as the GitHub API assistant:
a `bearer` or `apiKey` credential entry, an MCP server for
the tool interface, and proxy-enforced credential injection.

| Integration | Credential type | MCP server | Notes |
| ----------- | --------------- | ---------- | ----- |
| Jira / Jira Cloud | `bearer` (PAT) or `oauth2` | [mcp-server-jira][] or similar | Issue tracking, sprint boards, backlog queries |
| S3 / MinIO | AWS SigV4 or `apiKey` | [mcp-server-s3][] or custom | Upload artifacts, read data, agent workspace backup ([#56][cp56]) |
| GitLab | `bearer` (PAT) | [mcp-server-gitlab][] | Same pattern as GitHub; covers teams not on GitHub |
| Confluence / Wiki | `apiKey` or `bearer` | [mcp-server-confluence][] | Knowledge base access for enterprise context |
| PagerDuty / OpsGenie | `bearer` | Custom MCP | Incident response: read alerts, create incidents |
| SMTP / email | N/A (in-cluster relay) | Custom MCP | Send reports, notifications |

[mcp-server-jira]: https://github.com/smithery-ai/reference-servers
[mcp-server-s3]: https://github.com/smithery-ai/reference-servers
[mcp-server-gitlab]: https://github.com/smithery-ai/reference-servers
[mcp-server-confluence]: https://github.com/smithery-ai/reference-servers

For each integration, we need: a walkthrough (like the GitHub
one), a claw-collections manifest, and an enterprise profile
that combines the integration with a relevant persona.

### Agent memory and context

Give agents persistent memory across sessions so they
accumulate project knowledge over time.
([#51][cp51], [#66][cp66])

| Work item | Description |
| --------- | ----------- |
| Default context stack | Establish a simple, default set of context and memory files for new instances ([#66][cp66]) |
| Persistent memory with semantic search | Evaluate and integrate a memory backend (vector store or structured) ([#51][cp51]) |
| Workspace backup policy | Document PVC backup/restore and encryption-at-rest ([#56][cp56], [#47][cp47]) |

### Remaining scenarios

| Scenario | Name | Status |
| -------- | ---- | ------ |
| **B** | Per-department assistants with curated profiles | Open ([#23][cp23]) |
| **E** | Autonomous agent deployment | Open ([#26][cp26]) |

### Security hardening

| Work item | Issue |
| --------- | ----- |
| Red-teaming demo: guardrail bypass testing | [#1][cp1] |
| Remove cluster-wide pods/exec from operator RBAC | [#34][cp34] |
| Admission webhooks for CRD validation | [#37][cp37] |
| Pin images by digest; migrate to UBI base | [#39][cp39] |
| NetworkPolicy for the operator manager pod | [#41][cp41] |
| SECURITY.md with CVE reporting process | [#50][cp50] |

### Deployer and self-service

| Work item | Description |
| --------- | ----------- |
| Self-service portal | Web UI where business users provision their own instances without YAML ([#20][cp20]) |
| OpenShell plugin | Document and deploy at least one instance with OpenShell ([#30][cp30]) |
| CLI tooling audit | Verify the agent container ships the tools users expect ([#69][cp69]) |

### OLM and certification

| Work item | Issue |
| --------- | ----- |
| OperatorHub bundle | [#35][cp35] |
| CRD upgrade path with conversion webhook | [#38][cp38] |
| Red Hat Preflight certification | [#48][cp48] |

[cp1]: https://github.com/redhat-et/claw-project/issues/1
[cp2]: https://github.com/redhat-et/claw-project/issues/2
[cp4]: https://github.com/redhat-et/claw-project/issues/4
[cp20]: https://github.com/redhat-et/claw-project/issues/20
[cp23]: https://github.com/redhat-et/claw-project/issues/23
[cp26]: https://github.com/redhat-et/claw-project/issues/26
[cp30]: https://github.com/redhat-et/claw-project/issues/30
[cp34]: https://github.com/redhat-et/claw-project/issues/34
[cp35]: https://github.com/redhat-et/claw-project/issues/35
[cp37]: https://github.com/redhat-et/claw-project/issues/37
[cp38]: https://github.com/redhat-et/claw-project/issues/38
[cp39]: https://github.com/redhat-et/claw-project/issues/39
[cp41]: https://github.com/redhat-et/claw-project/issues/41
[cp43]: https://github.com/redhat-et/claw-project/issues/43
[cp44]: https://github.com/redhat-et/claw-project/issues/44
[cp45]: https://github.com/redhat-et/claw-project/issues/45
[cp46]: https://github.com/redhat-et/claw-project/issues/46
[cp47]: https://github.com/redhat-et/claw-project/issues/47
[cp48]: https://github.com/redhat-et/claw-project/issues/48
[cp50]: https://github.com/redhat-et/claw-project/issues/50
[cp51]: https://github.com/redhat-et/claw-project/issues/51
[cp56]: https://github.com/redhat-et/claw-project/issues/56
[cp66]: https://github.com/redhat-et/claw-project/issues/66
[cp69]: https://github.com/redhat-et/claw-project/issues/69
[co32]: https://github.com/redhat-et/claw-operator/issues/32
