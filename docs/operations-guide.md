# Operations guide

Recommended practices for running OpenClaw in production on
OpenShift. Each topic links to a detailed guide where one
exists; topics marked *planned* are coming soon.

## GitOps deployment with Argo CD

Deploy and manage OpenClaw instances declaratively through Git.
Argo CD watches the claw-collections repository and
automatically syncs OpenClaw resources to the cluster. Each user
gets a subdirectory under `manifests/` — Argo CD creates an
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

Store credentials in Git safely using Sealed Secrets, or
integrate with an enterprise vault using the External Secrets
Operator. Both patterns produce regular Kubernetes Secrets
that the Claw operator reads via `spec.credentials[].secretRef`.

| Pattern | Complexity | Rotation | Best for |
| ------- | ---------- | -------- | -------- |
| Sealed Secrets | Low | Manual (re-encrypt and commit) | Teams starting with GitOps |
| ESO + Vault | High | Automatic (`refreshInterval`) | Enterprise compliance requirements |

See [Sealed Secrets guide](sealed-secrets.md) for the full
walkthrough. ESO + Vault integration is tracked in
[#45][eso-issue].

[eso-issue]: https://github.com/redhat-et/claw-project/issues/45

## Custom agent image

The upstream OpenClaw container lacks CLI tools like `jq` and
`yq` that agents need for data processing. A thin overlay
image adds these tools without forking the upstream image.
A GitHub Actions workflow rebuilds automatically on tool list
changes, manual dispatch, and a weekly schedule that tracks
upstream releases.

See [Custom agent image](custom-agent-image.md) for the full
guide.

## Agent provisioning with S3 file exchange

End-to-end checklist for provisioning an agent with S3
backup/restore and file exchange. Covers Workload Identity
(IRSA) and static-key approaches, including ServiceAccount
setup, proxy passthrough, and workspace-seeded rclone
configuration — all in a single Claw CR.

See [Agent provisioning checklist](agent-provisioning.md)
for the full walkthrough.

## Agent backup and restore

Back up and restore agent workspaces to S3-compatible object
storage using `rclone`. Covers AWS IAM setup, Claw proxy
passthrough configuration, and per-agent backup prefixes.

See [Agent backup and restore](agent-backup-restore.md) for
the static-key approach, or [S3 file exchange with Workload
Identity](s3-workload-identity.md) for IRSA-based access
with no static credentials (recommended for ROSA and EKS
clusters).

## Upgrade procedures

*Planned.* Rolling upgrade strategies for the OpenClaw operator
and OpenClaw instances with zero-downtime considerations.

## Monitoring and observability

*Planned.* Dashboard templates and alerting rules for
tracking assistant health, token usage, and error rates.
