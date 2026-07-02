# OpenClaw on OpenShift: Why, Use Cases, and Security Readiness

## Executive Summary

OpenClaw is best understood as a runtime for long-running, tool-connected agents that own ongoing responsibilities. It is not simply another coding assistant. Tools like Claude Code help a developer complete an interactive coding task. OpenClaw is useful when a team wants an agent to watch systems, maintain context, respond to events, take bounded actions, and escalate when human approval is required.

This distinction matters for enterprise adoption. The same capabilities that make OpenClaw useful (persistence, memory, tool access, credentials, external inputs, and autonomy) are also what create security concerns. The answer is delegated responsibility inside enforceable boundaries: the capabilities create the value, and the platform enforces the limits. This document establishes why this class of work matters, walks through the concrete use cases we have built as deployable profiles, and closes with the operating model that makes those workflows acceptable in an enterprise environment.

## Why OpenClaw?

Most enterprise work is not a series of single isolated tasks. It is a stream of recurring operational responsibilities:

- Watching customer, market, or operational signals and escalating meaningful changes
- Tracking campaign calendars, content deadlines, approvals, and performance follow-ups
- Monitoring budget variance, invoices, renewals, purchase requests, and forecast changes
- Preparing recurring executive, manager, sales, or project briefings from scattered source material
- Following up on meeting action items, blockers, owners, and unresolved decisions
- Walking new hires, customers, or internal teams through multi-step onboarding processes
- Routing incoming requests, tickets, leads, issues, or approvals to the right owner
- Maintaining continuity across projects by remembering prior decisions, risks, dependencies, and handoffs
- Watching policy, compliance, vendor, release, or security changes that may require action
- Producing recurring status updates, summaries, reports, and exception alerts without rebuilding context each time

These workflows are persistent, event-driven, and spread across multiple systems. The value of OpenClaw is not that an agent can answer a question or generate code. The value is that an agent can be assigned a durable responsibility, with identity, tools, memory, policies, and operational boundaries.


| OpenClaw is | OpenClaw is not |
|---|---|
| A platform for persistent agents that observe, reason, act, and report over time | A generic chatbot with a longer context window |
| A way to delegate bounded operational responsibilities to agents | A cron job with an LLM attached |
| Enterprise-relevant when paired with identity, access control, auditability, isolation, and approval gates | An unrestricted autonomous employee |
| A complement to interactive coding assistants | A replacement for them |

## OpenClaw and Claude Code: Different Jobs

The most common first question is whether OpenClaw competes with session-based coding assistants. It does not; the two are optimized for different moments.

| Dimension | OpenClaw | Claude Code |
|---|---|---|
| Primary mode | Persistent, always-on | Interactive, in-session |
| Best for | Monitoring, memory, automation | Writing and changing code |
| Duration | Continuous, over time | A focused session |
| Human involvement | Low; works in the background | High; present and steering |
| Example task | "Brief me on overnight changes and risks." | "Refactor this and fix the test." |

## Use Cases: Claws as Code

The use cases below are early concepts, but they are concrete ones: each has been sketched as a versioned profile in the [claw-collections](https://github.com/redhat-et/claw-collections/tree/main/enterprise-profiles) repository under `enterprise-profiles/`. A profile is an agent defined as code: persona files (`SOUL.md`, `AGENTS.md`, `TOOLS.md`), an identity, and role-specific skills, all living in Git. Deploying one is a Claw custom resource pointing `agentFiles.git` at the profile directory. 

### Developer and Platform Teams

**Profiles: `shared-team`, `project-assistant`, `standard-user`**

The `shared-team` profile is a general software development team assistant: a team of five to ten developers shares one instance with shared credentials and a default persona (one Claw CR, one Secret). It owns project continuity: repo monitoring, PR briefs, CI failure triage, release notes, architecture memory, and safe cluster checks. The shared-instance pattern is intentionally bounded to low-risk, read-mostly team workflows (stages 1 and 2 on the adoption ladder below); identity and attribution are at team granularity. When per-user identity, auditability, or cost attribution matters, the per-user pattern applies instead. The `project-assistant` profile adds cross-repo project planning with GitHub API access, where the proxy injects the GitHub credential so the agent itself never holds a token. The `standard-user` profile is the per-developer variant for restricted-network environments, with per-user API keys for cost attribution.

Why a persistent agent: the state of a project (open threads, recent failures, in-flight decisions) changes continuously and lives across GitHub, CI, clusters, and chat. A session-based tool reassembles that context on every invocation; a persistent agent already has it.

### Human Resources

**Profile: `hr-specialist`**

Covers HR policy questions, internal communications, and onboarding. The profile ships an `onboarding-checklist` skill: when a new team member arrives, the agent walks the checklist, tracks what is outstanding, and follows up over days or weeks. Onboarding is a textbook durable responsibility: it spans systems (accounts, training, equipment, introductions), takes weeks, and fails precisely when nobody is holding the whole list.

### Finance and Operations

**Profile: `financial-analyst`**

Financial analysis, modeling, and reporting, with a `variance-analysis` skill. The agent monitors budgets and invoices, flags anomalies, tracks renewals, explains variance against plan, and remembers what was approved and why. The memory point is the differentiator: variance explanations depend on decisions made months earlier, which is exactly what session-based tools cannot retain.

### Executive Support

**Profile: `executive-assistant`**

Meeting preparation, executive communications, and strategic documents, with an `executive-brief` skill. The agent assembles briefing material ahead of recurring meetings, tracks follow-ups from previous ones, and maintains continuity across a calendar that never stops moving.

### Marketing and Communications

**Profile: `marketing-specialist`**

Campaigns, content, messaging, and performance. The agent tracks campaign calendars and deadlines, watches performance and brand mentions, drafts recurring content, and remembers what resonated. This is marketing-role work, owned end to end, not engineering output translated into marketing language.

### Candidate Profiles

Two personas from our roadmap do not yet have profiles and are natural next additions: a manager/lead assistant (weekly status and blocker tracking, meeting-note action items, 1:1 prep, continuity through handoffs) and a support/success assistant (escalation briefings, linking recurring problems to known bugs, remembering customer environments and incidents).

## Deployment Scenarios

The [claw-project](https://github.com/redhat-et/claw-project/issues) tracker sketches six deployment scenarios that pair these profiles with operational patterns. Like the profiles, these are design targets rather than proven deployments; they map out the shapes we believe enterprise adoption will take. They are ordered here from the most user flexibility to the most platform enforcement (the letters are identifiers from the tracker, not an ordering):

| Scenario | Pattern |
|---|---|
| D | Power user: operator provides infrastructure and the credential boundary only; user configures everything else |
| A | Shared team assistant: one CR, one Secret, 5 to 10 developers |
| B | Per-department assistants: curated profiles deployed from Git via ArgoCD |
| C | Locked-down enterprise: public registries blocked, internal mirrors, per-user keys for cost attribution |
| E | Autonomous agent: no human user, pinned config re-seeded on every restart, programmatic access, task queue via MCP |
| F | Locked-down kiosk: five hard enforcement layers (network, config, persona, skills, plugins) for regulated environments such as finance, healthcare, and legal |

## Why OpenClaw as the Reference Harness?

OpenClaw does not need to be positioned as the only agent harness that could run on OpenShift. Other harnesses, such as Hermes or similar agent frameworks, could also be containerized, deployed, connected to tools, and wrapped with some of the same platform controls. The enterprise question is not simply whether an agent harness can run on OpenShift. Many can.

The more important question is whether we can define a repeatable and governable pattern for running persistent, tool-connected agents in an enterprise environment. That requires more than an agent loop. It requires clear answers around identity, permissions, credentials, isolation, observability, memory governance, approval gates, lifecycle management, and auditability.

OpenClaw should be treated as the reference harness for this pattern. The goal is not to claim that OpenClaw is automatically enterprise-ready. The goal is to use OpenClaw to prove what an enterprise-ready agent deployment model should look like on OpenShift. Any other harness would still face the same review: how it stores memory, how it loads tools or skills, how it handles credentials, how it processes untrusted input, how it records actions, and how it supports approval workflows. OpenClaw is the selected target for building that evaluation and hardening path.

## Running It on OpenShift

OpenShift provides the governance layer: workload isolation, service accounts, RBAC, secrets management, network policy, observability, image scanning, and lifecycle controls. OpenClaw provides the agent behavior being governed by those controls.

In practice, the deployed pattern looks like this. Each instance runs in its own namespace. The OpenClaw gateway pod runs the agent and never sees an API key; it runs under the restricted SCC (non-root, SELinux confinement, seccomp filtering, all Linux capabilities dropped) with no service account token mounted by default. NetworkPolicy blocks all direct egress from the agent pod and restricts ingress to the OpenShift router. The only route out is a credential proxy, which injects secrets into outbound requests at the network boundary and rejects any domain that is not explicitly allowlisted, over HTTPS only. The proxy is general-purpose, not LLM-specific: it supports seven injection types (`apiKey`, `bearer`, `gcp`, `pathToken`, `oauth2`, `kubernetes`, `none`), covering LLM providers, GitHub, Telegram, enterprise SSO APIs, Kubernetes API servers, and allowlist-only passthrough; see the [proxy security FAQ](proxy-security-faq.md#can-the-proxy-be-used-for-non-llm-credentials). Credentials live in user-managed Kubernetes Secrets, compatible with Vault and External Secrets Operator. The endpoints the agent can reach (LLM APIs, the Kubernetes API server, declared tools) are the endpoints the deployment declares, and nothing else.

Not mounting a service account token by default means the agent has no implicit cluster identity. When a use case needs the Kubernetes API, access is granted one of two explicit ways. The first is proxied: a `kubernetes`-type credential (a standard kubeconfig stored in a Secret) whose token the proxy injects at the boundary while stripping anything the agent presents; the RBAC scope of that token is decided by whoever provisions it (least privilege, typically namespace-scoped), and rotating it is a Secret update. The second is direct: `spec.serviceAccountName` opts the gateway pod into a named ServiceAccount, whose token is then mounted and whose permissions are exactly the RBAC granted to that account, with token rotation handled by Kubernetes. In both paths the grant is declared in the Claw resource, so cluster access is always explicit and reviewable, never ambient.

Everything that confines the agent to the proxy is stock OpenShift. The claw-operator is the reference implementation that stamps this pattern out per instance: it makes deployment and scale easy, but the enforcement comes from the platform.

## Adoption Model

The adoption model moves from low-risk observation to increasingly capable action. Each stage has a clear permission boundary and review model, so capability grows only as trust and controls are proven.

1. **Read-only.** Agents summarize, classify, and report. No writes.
2. **Low-risk writes.** Labels, draft comments, internal notes, generated reports.
3. **PR-based changes.** Code or configuration changes reviewed before merge.
4. **Gated writes.** Operational systems, only with narrow RBAC, strong auditability, and clear rollback paths.
5. **Privileged.** Cross-namespace actions, reserved for mature workflows with explicit approvals and platform-level controls.

The deployment scenarios map onto this ladder: Scenario A would start a team at stages 1 and 2, Scenario B scales that across departments, and Scenarios E and F sketch what stages 4 and 5 could look like when hard enforcement (pinned config, read-only personas and skills, blocked plugin installation) replaces trust.

## Security Framing

OpenClaw should be presented as delegated responsibility inside enforceable boundaries. The story is not unrestricted autonomy. The story is controlled autonomy: the agent can observe broadly where appropriate, act narrowly where permitted, and escalate when the action carries meaningful risk. Each use case should explicitly define what the agent can read, what it can write, what requires human approval, what is logged, what credentials or permissions are intentionally denied, and what residual risk remains after controls are applied.

Every capability pairs its value with a named mechanism, most of them stock OpenShift primitives:

| Capability | Value | Security Risk | Control on OpenShift |
|---|---|---|---|
| Persistence | The agent can track work over time. | Long-lived access widens blast radius. | Namespace-scoped identity plus RBAC, periodic permission review, audit logs. |
| Memory | The agent can retain project context. | Memory poisoning or stale context. | Instance-scoped storage, provenance, reviewable memory updates. |
| Tool access | The agent can take useful action. | Unauthorized or unsafe action. | Least-privilege RBAC per namespace, approval gates, restricted tools. |
| External inputs | The agent can watch issues, chats, docs, and tickets. | Prompt injection from untrusted content. | NetworkPolicy egress allowlist bounds what injection can reach; treat external text as untrusted. |
| Credentials | The agent can connect to real systems. | Secret leakage or misuse. | Kubernetes Secrets plus proxy injection: the agent never holds keys. |
| Autonomy | The agent reduces manual toil. | Harder accountability. | Action logs, platform observability, clear ownership, human approval thresholds. |
| Skills/plugins | The agent can be extended. | Supply-chain risk. | Profiles versioned and reviewed in Git, pinned versions, image scanning; no keys in the pod to steal, no route out but the allowlist. |

## Use Case Security Matrix

The supporting spreadsheet converts this narrative into an enterprise review artifact. Each row describes a real use case and maps it to permissions, concerns, mitigations, residual risk, and maturity, so that every workflow becomes reviewable before it runs. For questions about the credential boundary itself, see the [proxy security FAQ](proxy-security-faq.md).

| Column | Purpose |
|---|---|
| Use case | Short name for the workflow. |
| Persona | Primary user or team: developer, platform admin, researcher, PM, finance, marketing, support. |
| What the agent does | Plain-language description of the behavior. |
| Why OpenClaw | Core reason this requires a persistent agent. |
| Inputs | Issues, PRs, logs, metrics, docs, Slack, email, cluster events, tickets, reports. |
| Actions & systems | What it does and where: labels, comments, PRs, notifications, summaries; GitHub, OpenShift, Jira, Slack, Grafana, docs, internal systems. |
| Data sensitivity | Highest classification of data the workflow touches: public, internal, confidential. |
| Required permissions | Read-only, comment, issue write, PR write, cluster read, namespace write, dashboard write. |
| Security concerns | Prompt injection, over-permissioning, secret exposure, unsafe writes, data leakage, bad recommendations. |
| How addressed | RBAC, network policy, approval gates, audit logs, scoped credentials, sandboxing, review workflows. |
| Residual risk | Remaining risk after mitigations. |
| Adoption stage (1-5) | Stage on the adoption ladder: read-only, low-risk writes, PR-based changes, gated writes, privileged. |
| Human in the Loop | When and what a person must approve before the agent acts. |
| Maturity level | Safe now, needs guardrails, future, research. |

## Conclusion

The strongest OpenClaw story is not that it replaces existing AI tools. It is that it makes a different class of work possible: persistent, event-driven, tool-connected, policy-bounded agent workflows.

Three things make that story credible today:

1. **A new class of work.** Durable responsibilities, delegated to agents, already taking shape as profiles defined in Git.
2. **Governed by OpenShift.** NetworkPolicy, SCC, RBAC, Secrets, and namespaces, the same primitives that run regulated workloads, confine the agent.
3. **Trust earned in stages.** From read-only observation to privileged action, capability grows only as evidence accumulates.

Pick one responsibility. Start it read-only. Let the evidence move it up the ladder.
