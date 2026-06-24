# Operations guide

Recommended practices for running OpenClaw in production on
OpenShift. Each topic links to a detailed guide where one
exists; topics marked *planned* are coming soon.

## GitOps deployment with ArgoCD

Deploy and manage Claw instances declaratively through Git.
ArgoCD watches the claw-collections repository and
automatically syncs Claw resources to the cluster. Each user
gets a subdirectory under `manifests/` — ArgoCD creates an
Application per directory, targeting the matching namespace.

See [GitOps setup guide](gitops-setup.md) for the full
walkthrough.

## Git-based change tracking

Track changes to agent workspace Markdown files (SOUL.md,
AGENTS.md, USER.md, TOOLS.md) using Git. This gives teams a
full history of how agent configuration evolves, with the
ability to audit and revert changes. Two approaches are
covered: agent-driven cooperative commits and operator-driven
init containers.

See [Git-based change tracking](git-change-tracking.md) for
implementation details.

## Cost attribution strategies

*Planned.* Patterns for tracking per-team and per-user LLM
spend using gateway-level metrics and Kubernetes labels.

## Secret management patterns

*Planned.* Integration patterns for ExternalSecrets and
SealedSecrets to manage API keys and credentials across
multi-user deployments.

## Upgrade procedures

*Planned.* Rolling upgrade strategies for the Claw operator
and OpenClaw instances with zero-downtime considerations.

## Monitoring and observability

*Planned.* Dashboard templates and alerting rules for
tracking assistant health, token usage, and error rates.
