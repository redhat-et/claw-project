# Agent provisioning checklist

Step-by-step checklist for a cluster admin provisioning an
OpenClaw agent with S3 file exchange. Covers both Workload
Identity (recommended) and static-key approaches. Each step
links to the detailed guide where the full commands live.

Use this checklist when onboarding a new user or team that
needs an agent with backup/restore or file exchange
capabilities.

## Prerequisites

| Requirement | How to check |
| --- | --- |
| Claw operator installed | `oc get crd claws.claw.sandbox.redhat.com` |
| Custom agent image with rclone | See [Custom agent image](custom-agent-image.md) |
| S3 bucket created | `aws s3 ls s3://<bucket>` |
| Namespace for the agent | `oc get project <namespace>` |

## Decision: Workload Identity or static keys?

| | Workload Identity (IRSA) | Static keys |
| --- | --- | --- |
| **Cluster requirement** | OIDC provider (ROSA STS, EKS) | Any cluster |
| **Credential rotation** | Automatic (no maintenance) | Manual |
| **Secrets in cluster** | None | IAM access key in a Secret |
| **Setup complexity** | Higher (one-time OIDC + IAM role) | Lower |
| **Recommendation** | Production | Development/demos |

## Checklist: Workload Identity (recommended)

Detailed commands for each step are in the linked guides.

### AWS side (one-time per cluster)

- [ ] Register the cluster OIDC provider in IAM
      ([instructions](s3-workload-identity.md#register-the-oidc-provider))
- [ ] Verify the provider exists:
      `aws iam list-open-id-connect-providers`

### AWS side (per agent or per team)

- [ ] Create an IAM role with an OIDC trust policy scoped
      to the agent's namespace and ServiceAccount
      ([instructions](s3-workload-identity.md#create-an-iam-role))
- [ ] Attach a bucket-scoped policy to the role
      ([instructions](s3-workload-identity.md#attach-a-bucket-scoped-policy))
- [ ] Note the role ARN:
      `aws iam get-role --role-name <role> --query Role.Arn`

### Kubernetes side (per agent)

- [ ] Create a ServiceAccount with the IRSA annotation
      ([instructions](s3-workload-identity.md#kubernetes-serviceaccount)):

      ```yaml
      apiVersion: v1
      kind: ServiceAccount
      metadata:
        name: <agent-name>-s3
        namespace: <namespace>
        annotations:
          eks.amazonaws.com/role-arn: <ROLE_ARN>
      ```

- [ ] Create the Claw CR with `serviceAccountName`, proxy
      passthrough, and rclone config seeded via workspace:

      ```yaml
      apiVersion: claw.sandbox.redhat.com/v1alpha1
      kind: Claw
      metadata:
        name: <agent-name>
        namespace: <namespace>
      spec:
        serviceAccountName: "<agent-name>-s3"
        credentials:
          - name: anthropic
            provider: anthropic
            secretRef:
              - name: <agent-name>-anthropic
                key: api-key
          - name: aws-s3
            type: none
            domain: ".amazonaws.com"
        workspace:
          inline:
            - path: ".config/rclone/rclone.conf"
              content: |
                [backup]
                type = s3
                provider = AWS
                env_auth = true
                region = us-east-1
                no_check_bucket = true
      ```

- [ ] Verify the pod starts with the correct ServiceAccount:
      `oc get pod -l app=claw -o jsonpath='{..serviceAccountName}'`
- [ ] Verify IRSA environment variables are injected:
      `oc exec <pod> -c gateway -- env | grep AWS`

### Verify S3 connectivity (from inside the agent)

- [ ] Test rclone access: `rclone ls backup:<bucket>`
- [ ] Test backup:
      `rclone sync /home/node/.openclaw backup:<bucket>/<agent-name>/ --exclude "npm/**"`

## Checklist: static keys

Use this approach on clusters without OIDC support.
Detailed commands are in
[Agent backup and restore](agent-backup-restore.md).

### AWS side

- [ ] Create an IAM user for backups
      ([instructions](agent-backup-restore.md#create-an-iam-user))
- [ ] Attach a bucket-scoped policy
      ([instructions](agent-backup-restore.md#attach-a-bucket-scoped-policy))
- [ ] Generate access keys and note them:
      `aws iam create-access-key --user-name <user>`

### Kubernetes setup (per agent)

- [ ] Create a Claw CR with proxy passthrough and rclone
      config seeded via workspace:

      ```yaml
      apiVersion: claw.sandbox.redhat.com/v1alpha1
      kind: Claw
      metadata:
        name: <agent-name>
        namespace: <namespace>
      spec:
        credentials:
          - name: anthropic
            provider: anthropic
            secretRef:
              - name: <agent-name>-anthropic
                key: api-key
          - name: aws-s3
            type: none
            domain: ".s3.us-east-1.amazonaws.com"
        workspace:
          inline:
            - path: ".config/rclone/rclone.conf"
              content: |
                [backup]
                type = s3
                provider = AWS
                access_key_id = <ACCESS_KEY>
                secret_access_key = <SECRET_KEY>
                region = us-east-1
                no_check_bucket = true
      ```

> [!WARNING]
> Static keys are embedded in the rclone config inside the
> workspace. Anyone with access to the agent pod can read
> them. Prefer Workload Identity for production deployments.

### Verify static-key S3 connectivity

- [ ] Test rclone access: `rclone ls backup:<bucket>`
- [ ] Test backup:
      `rclone sync /home/node/.openclaw backup:<bucket>/<agent-name>/ --exclude "npm/**"`

## Adding the backup skill

Optionally, include the backup skill so the agent can
back up and restore its own personality files on demand.
Add a `spec.skills` entry to the Claw CR with the skill
description from the
[backup skill proposal](../backup-skill-proposal.md).
The skill uses the pre-configured `backup` rclone remote
to sync personality files (SOUL.md, IDENTITY.md, USER.md,
AGENTS.md, TOOLS.md) to S3 under a per-agent prefix.

## What the operator does not manage

The following remain outside the Claw CRD by design:

| Concern | Why it is external | Where it lives |
| --- | --- | --- |
| S3 bucket creation | Cloud-side resource | AWS CLI / Terraform |
| IAM role and policy | Cloud-side resource | AWS CLI / Terraform |
| OIDC provider registration | One-time cluster setup | AWS CLI |
| rclone remote name and paths | Runtime agent config | `spec.workspace.inline` |

The CRD provides the building blocks
(`serviceAccountName`, `credentials[type:none]`,
`workspace.inline`) without encoding S3-specific
assumptions. This keeps the CRD provider-neutral — the
same pattern works for GCS, Azure Blob, or any
rclone-supported backend by changing the workspace-seeded
rclone.conf.

## References

- [S3 file exchange with Workload Identity](s3-workload-identity.md)
- [Agent backup and restore (static keys)](agent-backup-restore.md)
- [Custom agent image](custom-agent-image.md)
- [Enterprise onboarding workflows](enterprise-onboarding-workflows.md)
