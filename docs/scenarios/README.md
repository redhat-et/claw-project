# Deployment scenarios

Step-by-step guides for deploying AI assistants on OpenShift
using the Claw operator. Start with the simplest scenario and
add complexity as your needs grow.

## Reading order

The scenarios are ordered from simplest to most controlled.
Each builds on concepts from the previous one.

| Guide | Scenarios | Audience |
| ----- | --------- | -------- |
| [Your first AI assistant](scenario-a-shared-team.md) | D, A | Individual developer, then shared team |
| [Registry lockdown](scenario-c-registry-lockdown.md) | C | Block public registries, use internal mirrors, per-user keys |
| Per-department profiles | B | IT admin deploying tailored assistants per department |
| Autonomous agent | E | Unattended agent processing tasks from a queue |
| [Locked-down kiosk](scenario-f-kiosk-guardrails.md) | F | Regulated environments with strict guardrails |

Scenarios B and E are documented in
[enterprise onboarding workflows](../enterprise-onboarding-workflows.md)
and will get dedicated walkthrough guides as they are
validated on test clusters.

## Concepts

All scenarios share the same building blocks:

- **Claw CR** — the Kubernetes custom resource that defines
  an assistant instance
- **Credential proxy** — injects API keys into outbound LLM
  requests so the gateway container never sees them
- **PVC** — persistent workspace storage for conversations
  and configuration
- **agentFiles** — optional Git-based seeding of persona,
  skills, and config into the workspace
- **readOnly** — filesystem-enforced protection for specific
  workspace files

Simpler scenarios omit `agentFiles` and `readOnly`; more
controlled scenarios use both.
