# Agent backup and restore with rclone

Back up and restore OpenClaw agent workspaces using
[rclone](https://rclone.org/). Rclone supports
[over 70 storage backends][rclone-providers] including AWS S3,
Google Cloud Storage, Azure Blob, SFTP, and self-hosted
options like Garage and Ceph RGW. This guide uses AWS S3 as
the example, but the rclone configuration and backup/restore
commands work with any supported backend.

[rclone-providers]: https://github.com/rclone/rclone#storage-providers

> [!NOTE]
> This guide uses static IAM access keys configured inside
> the agent. For clusters with OIDC support (ROSA, EKS),
> see [S3 file exchange with Workload
> Identity](s3-workload-identity.md) for a zero-static-secrets
> approach using short-lived, auto-rotating credentials.

## Prerequisites

- Custom agent image with `rclone` installed
  (see [custom agent image guide](custom-agent-image.md))
- An S3 bucket
- IAM credentials scoped to that bucket

## AWS setup

### Create a bucket

```bash
aws s3 mb s3://panni-claw-backups --region us-east-1
```

### Create an IAM user

```bash
aws iam create-user --user-name claw-backup
```

### Attach a bucket-scoped policy

The policy grants only the permissions rclone needs —
list, get, put, and delete — scoped to a single bucket:

```bash
aws iam put-user-policy \
  --user-name claw-backup \
  --policy-name claw-backup-s3 \
  --policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::panni-claw-backups"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::panni-claw-backups/*"
    }
  ]
}'
```

### Create access keys

```bash
aws iam create-access-key --user-name claw-backup
```

Save the `AccessKeyId` and `SecretAccessKey` from the
output — the secret is shown only once.

| Item | Value |
| ---- | ----- |
| IAM user | `claw-backup` |
| Access Key ID | `AKIAIOSFODNN7EXAMPLE` |
| Secret Access Key | *(stored in password manager — not committed to Git)* |
| Bucket | `s3://panni-claw-backups` |
| Region | `us-east-1` |

## Claw CR configuration

The Claw proxy blocks all outbound traffic by default. Add
an S3 passthrough route to `spec.credentials` using type
`none` (no credential injection, just allow traffic):

```yaml
spec:
  credentials:
    - name: aws-s3
      type: none
      domain: .s3.us-east-1.amazonaws.com
```

> [!IMPORTANT]
> Use a **leading dot** for suffix matching. AWS S3 uses
> virtual-hosted bucket URLs like
> `panni-claw-backups.s3.us-east-1.amazonaws.com`, so the
> domain must match the suffix, not just the base hostname.

Apply the updated CR:

```bash
oc apply -f your-claw-cr.yaml
```

Verify the proxy picked up the new route:

```bash
oc logs deployment/<instance>-proxy --tail=5
```

Look for an increased route count in the startup log
(e.g. `"routes":10` instead of `"routes":9`).

## Rclone configuration on the agent

Run this inside the agent (or ask the agent to run it):

```bash
rclone config create claw-s3 s3 \
  provider AWS \
  access_key_id AKIAIOSFODNN7EXAMPLE \
  secret_access_key "<your-secret-key>" \
  region us-east-1
```

Disable bucket creation checks (the IAM user has no
`s3:CreateBucket` permission):

```bash
rclone config update claw-s3 no_check_bucket true
```

Test connectivity:

```bash
rclone ls claw-s3:panni-claw-backups
```

An empty listing with no errors means the passthrough is
working.

## Backup

Back up the agent workspace to a per-agent prefix:

```bash
rclone sync /home/node/.openclaw claw-s3:panni-claw-backups/<agent-name>/
```

For example:

```bash
rclone sync /home/node/.openclaw claw-s3:panni-claw-backups/marketing-specialist/
```

This uses `sync` (mirror source to destination). Files
deleted locally will be deleted in S3 too. Use `copy`
instead if you want to keep deleted files in the backup.

## Restore

Restore the workspace from the backup:

```bash
rclone sync claw-s3:panni-claw-backups/<agent-name>/ /home/node/.openclaw
```

After restoring, restart the agent pod so OpenClaw picks up
the restored config and workspace files.

## Per-agent prefix convention

Use the agent name as the S3 prefix to keep backups
organized:

```text
s3://panni-claw-backups/
  marketing-specialist/
  code-reviewer/
  project-manager/
```

All agents share one bucket and one set of credentials.
Per-agent IAM scoping (restricting each agent to its own
prefix) can be added later with IAM policy conditions if
needed.

## Troubleshooting

**Proxy blocks S3 traffic:**
Check the proxy logs for `blocked CONNECT to unknown domain`.
If you see `<bucket>.s3.<region>.amazonaws.com` being
blocked, the credential entry is missing or uses an exact
domain match instead of a suffix match (leading dot).

**Rclone timeout with no output:**
The agent may assume you're using in-cluster object storage
and ask for an endpoint URL. Confirm you're using standard
AWS S3 — no custom endpoint is needed.

**`169.254.169.254` blocked in proxy logs:**
This is the EC2 instance metadata service. The proxy
correctly blocks it — the agent should not access node-level
AWS credentials. Use the explicit IAM user credentials
configured in rclone instead.

## Agent skill

A `personality-backup` skill is being developed in
[claw-collections][claw-collections] to let agents run
backup and restore operations themselves. The skill supports
two modes:

- **Full backup** (default) — syncs the entire
  `/home/node/.openclaw` directory, preserving conversations,
  memory, plugins, config, and workspace files
- **Personality only** — backs up only the identity files
  (SOUL.md, IDENTITY.md, USER.md, AGENTS.md, TOOLS.md) for
  users concerned about privacy or who only need to migrate
  the agent's character to a new instance

The skill is installed into every agent via
`spec.workspace.gitSources` in the Claw CR. See the
claw-collections repo for the current SKILL.md.

[claw-collections]: https://github.com/redhat-et/claw-collections

## References

- [Custom agent image guide](custom-agent-image.md)
- [Proxy security FAQ](proxy-security-faq.md)
- [rclone S3 documentation](https://rclone.org/s3/)
