# S3 file exchange with Workload Identity

Exchange files between OpenClaw agents and AWS S3 using
[Workload Identity (IRSA)][irsa]. Agents get short-lived,
auto-rotating credentials via a projected ServiceAccount
token — no static AWS keys are stored in the cluster or
exposed to the agent. This enables backup/restore, document
import/export, cross-agent handoff, and external access to
agent-produced files.

This guide uses AWS S3 as the example, but the same
pattern applies to any cloud storage backend. The agent
uses [rclone][rclone], which supports
[over 70 storage providers][rclone-providers] including
Google Cloud Storage, Azure Blob, and self-hosted options
like Ceph RGW. Each cloud provider has its own Workload
Identity mechanism (GCP Workload Identity, Azure Workload
Identity), but the Kubernetes side is the same: annotate a
ServiceAccount, assign it to the pod via
`spec.serviceAccountName`, and let the cloud SDK handle
credential discovery.

For clusters without OIDC support, see the static-key
approach in [Agent backup and restore](agent-backup-restore.md).

## How it works

```text
┌─────────────────────────────────────────────────────────┐
│ OpenShift / EKS cluster                                 │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │ kubelet      │    │ IRSA webhook │                   │
│  │              │    │ (mutating    │                   │
│  │ projects SA  │    │  admission)  │                   │
│  │ token into   │    │              │                   │
│  │ the pod      │    │ injects      │                   │
│  │   │          │    │ AWS_ROLE_ARN │                   │
│  │   │          │    │ + token path │                   │
│  │   ▼          │    │   │          │                   │
│  │ ┌────────────┴────┴───▼────────┐ │                   │
│  │ │       gateway pod            │ │                   │
│  │ │                              │ │                   │
│  │ │  rclone (env_auth=true)      │ │                   │
│  │ │    │                         │ │                   │
│  │ │    │ 1. reads projected      │ │                   │
│  │ │    │    SA token             │ │                   │
│  │ │    │    (auto-rotated        │ │                   │
│  │ │    │     by kubelet)         │ │                   │
│  │ │    │                         │ │                   │
│  └─┤    ▼                         │ │                   │
│    │ 2. calls STS ────────────────┼─┼──► AWS STS        │
│    │    AssumeRoleWith            │ │   validates token │
│    │    WebIdentity               │ │    against OIDC   │
│    │                              │ │   provider, then  │
│    │ 3. receives temporary ◄──────┼─┼─── returns temp   │
│    │    credentials               │ │    credentials    │
│    │    (valid ~1 hour)           │ │    (access key +  │
│    │                              │ │     secret + tok) │
│    │ 4. signs S3 requests ────────┼─┼──► AWS S3         │
│    │    with temp creds           │ │                   │
│    │                              │ │                   │
│    └──────────────────────────────┘ │                   │
│              ▲                      │                   │
│              │ proxy: type:none     │                   │
│              │ (passthrough,        │                   │
│              │  no MITM)            │                   │
│    ┌─────────┴──────────┐           │                   │
│    │    proxy pod       │           │                   │
│    └────────────────────┘           │                   │
└─────────────────────────────────────────────────────────┘
         ▲
         │ aws s3 ls / cp
         │
    ┌────┴──────────┐
    │  workstation  │  (direct S3 access
    │  (aws CLI)    │   with own IAM creds)
    └───────────────┘
```

The key insight: **no one configures or rotates credentials
after the initial setup.** The kubelet automatically
rotates the projected SA token before it expires. The AWS
SDK detects expiration of the STS temporary credentials
and re-calls `AssumeRoleWithWebIdentity` transparently.
The entire chain is self-renewing — there is nothing to
refresh a week, a month, or a year later.

The only maintenance events are:

| Event                              | Action needed                                                 |
| ---------------------------------- | ------------------------------------------------------------- |
| Cluster OIDC certificate rotates   | Update the thumbprint in the IAM OIDC provider                |
| IAM role permissions change        | Update the IAM policy (no cluster changes)                    |
| Cluster is destroyed and recreated | Re-register the new OIDC provider and update the trust policy |

## Prerequisites

- An AWS account with S3 and IAM access (`aws` CLI
  configured)
- A ROSA or EKS cluster with an OIDC provider configured
  (ROSA STS clusters have this by default)
- The upstream operator with `serviceAccountName` support
  ([PR #240][upstream-pr])
- A custom agent image with `rclone` installed (see
  [Custom agent image](custom-agent-image.md))

## AWS setup

### Create an S3 bucket

Skip this if you already have a bucket.

```bash
aws s3 mb s3://my-claw-backups --region us-east-1
```

### Register the OIDC provider

Get the cluster's OIDC issuer URL:

```bash
oc get authentication cluster \
  -o jsonpath='{.spec.serviceAccountIssuer}'
```

Save the output — you will need it for the trust policy.
The URL looks like:

```text
https://rh-oidc.s3.us-east-1.amazonaws.com/<cluster-id>
```

Get the OIDC endpoint's TLS thumbprint:

```bash
OIDC_HOST=$(oc get authentication cluster \
  -o jsonpath='{.spec.serviceAccountIssuer}' \
  | sed 's|https://||')

openssl s_client -connect "${OIDC_HOST}:443" \
  -servername "${OIDC_HOST}" </dev/null 2>/dev/null \
  | openssl x509 -fingerprint -sha1 -noout \
  | sed 's/://g' | cut -d= -f2
```

Register the provider in IAM:

```bash
aws iam create-open-id-connect-provider \
  --url "$(oc get authentication cluster \
    -o jsonpath='{.spec.serviceAccountIssuer}')" \
  --client-id-list openshift \
  --thumbprint-list <THUMBPRINT>
```

This step tells AWS "I trust tokens issued by this
cluster's OIDC endpoint." The thumbprint lets STS verify
that the OIDC endpoint's TLS certificate is legitimate.
Without this registration, STS has no way to validate the
projected SA token and rejects it with
`InvalidIdentityToken`.

> [!IMPORTANT]
> ROSA clusters project ServiceAccount tokens with audience
> `openshift`, not `sts.amazonaws.com`. The `--client-id-list`
> must match this audience — otherwise STS rejects the token
> with `InvalidIdentityToken`. EKS clusters use
> `sts.amazonaws.com` instead.

### Create an IAM role

Set the variables used in the commands below:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity \
  --query Account --output text)

OIDC_PROVIDER=$(oc get authentication cluster \
  -o jsonpath='{.spec.serviceAccountIssuer}' \
  | sed 's|https://||')

NAMESPACE=<your-namespace>
SA_NAME=<your-service-account>
```

Create the role with an OIDC trust policy scoped to a
specific ServiceAccount:

```bash
aws iam create-role \
  --role-name claw-s3-backup \
  --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::'$ACCOUNT_ID':oidc-provider/'$OIDC_PROVIDER'"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "'$OIDC_PROVIDER':sub": "system:serviceaccount:'$NAMESPACE':'$SA_NAME'",
          "'$OIDC_PROVIDER':aud": "openshift"
        }
      }
    }
  ]
}'
```

The `Condition` block is the security boundary. The `sub`
condition ensures only pods running as the named
ServiceAccount in the specified namespace can assume this
role. The `aud` condition ensures the token was issued
with the expected audience. A pod in any other namespace,
or using any other ServiceAccount, is denied by STS.

### Attach a bucket-scoped policy

Grant only the permissions rclone needs — list, get, put,
and delete — scoped to a single bucket:

```bash
aws iam put-role-policy \
  --role-name claw-s3-backup \
  --policy-name claw-s3-access \
  --policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::my-claw-backups"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::my-claw-backups/*"
    }
  ]
}'
```

Get the role ARN — you will need it for the ServiceAccount
annotation:

```bash
aws iam get-role --role-name claw-s3-backup \
  --query 'Role.Arn' --output text
```

## Kubernetes ServiceAccount

Create a ServiceAccount with the IRSA annotation in the
agent's namespace:

```bash
oc apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: claw-s3
  namespace: <your-namespace>
  annotations:
    eks.amazonaws.com/role-arn: <ROLE_ARN>
EOF
```

The `eks.amazonaws.com/role-arn` annotation is what the
IRSA mutating webhook looks for. When a pod uses this
ServiceAccount, the webhook automatically injects the
`AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`
environment variables and mounts the projected token.
The ServiceAccount itself has no Kubernetes RBAC
privileges — it is purely a carrier for the IAM role
reference.

Verify:

```bash
oc get sa claw-s3 -n <your-namespace> \
  -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}'
```

## Claw CR configuration

Add two fields to the Claw CR:

- `spec.serviceAccountName` — the IRSA-annotated
  ServiceAccount
- An S3 passthrough route in `spec.credentials` with
  `type: none`

```yaml
spec:
  serviceAccountName: "claw-s3"
  credentials:
    - name: aws-s3
      type: none
      domain: ".amazonaws.com"
```

> [!IMPORTANT]
> Use `.amazonaws.com` (not just `.s3.*.amazonaws.com`).
> Workload Identity needs both S3 endpoints and
> `sts.amazonaws.com` for the token exchange. The broad
> suffix covers both.
>
> **Security trade-off:** `.amazonaws.com` allows egress to
> all AWS service endpoints, not just S3 and STS. The IAM
> role restricts what the agent can *do* (only S3 on one
> bucket), but the network path is wider than necessary.
> For tighter defense-in-depth, use two separate entries:
>
> ```yaml
> - name: aws-sts
>   type: none
>   domain: "sts.amazonaws.com"
> - name: aws-s3
>   type: none
>   domain: ".s3.us-east-1.amazonaws.com"
> ```
>
> This limits egress to STS and S3 in a single region.
> The broader `.amazonaws.com` is acceptable for demos and
> development clusters where simplicity is preferred.

A complete example manifest is available at
[`manifests/claw-s3-demo.yaml`](../manifests/claw-s3-demo.yaml).

Apply the CR and verify the gateway pod starts with the
custom ServiceAccount:

```bash
oc apply -f your-claw-cr.yaml -n <your-namespace>

oc get pod -n <your-namespace> -l app=claw \
  -o jsonpath='{.items[0].spec.serviceAccountName}'
```

Confirm the IRSA webhook injected the expected environment
variables (use the gateway pod from the previous command,
or the label selector):

```bash
oc exec -n <your-namespace> \
  $(oc get pod -n <your-namespace> -l app=claw \
    -o jsonpath='{.items[0].metadata.name}') \
  -c gateway -- env | grep AWS
```

Expected output:

```text
AWS_ROLE_ARN=arn:aws:iam::<account>:role/claw-s3-backup
AWS_DEFAULT_REGION=us-east-1
AWS_WEB_IDENTITY_TOKEN_FILE=/var/run/secrets/eks.amazonaws.com/serviceaccount/token
AWS_REGION=us-east-1
```

## Rclone configuration

Configure rclone inside the agent with `env_auth=true`.
This tells rclone to use the IRSA-provided credentials
instead of static keys:

```bash
rclone config create claw-s3 s3 \
  provider AWS \
  env_auth true \
  region us-east-1 \
  no_check_bucket true
```

Test connectivity:

```bash
rclone ls claw-s3:my-claw-backups
```

An empty listing with no errors means the full chain
works: projected token, STS, temporary credentials, S3
access.

Unlike the static-key approach in
[agent-backup-restore.md](agent-backup-restore.md), there
is no `access_key_id` or `secret_access_key` anywhere in
the rclone config. The `env_auth=true` setting tells
rclone to discover credentials from the environment —
in this case, the `AWS_WEB_IDENTITY_TOKEN_FILE` and
`AWS_ROLE_ARN` variables injected by the IRSA webhook.
The AWS SDK handles the STS token exchange transparently.

## Save files to S3

Sync the agent workspace to S3 under a per-agent prefix:

```bash
rclone sync /home/node/.openclaw \
  claw-s3:my-claw-backups/my-agent/ \
  --exclude "npm/**"
```

> [!NOTE]
> The `npm/` directory contains Node.js dependencies that
> are reinstalled on pod startup. Excluding it reduces
> backup size significantly (e.g. 1.7 MiB vs 35 MiB).

Use the agent name as the S3 prefix to keep files
organized:

```text
s3://my-claw-backups/
  marketing-specialist/
  code-reviewer/
  project-manager/
```

## Load files from S3

Restore the workspace from S3:

```bash
rclone sync claw-s3:my-claw-backups/my-agent/ \
  /home/node/.openclaw \
  --exclude "npm/**"
```

After restoring, restart the agent pod so OpenClaw picks
up the restored configuration and workspace files.

## Access files externally

Files saved to S3 are accessible from any machine with
AWS credentials for the bucket — not just from inside the
cluster. This is the key advantage over PVC-only storage.

List agent files from your workstation:

```bash
aws s3 ls s3://my-claw-backups/my-agent/workspace/
```

Download a specific file:

```bash
aws s3 cp s3://my-claw-backups/my-agent/workspace/SOUL.md .
```

Upload a document for the agent to process:

```bash
aws s3 cp report.pdf \
  s3://my-claw-backups/my-agent/workspace/imports/
```

## Troubleshooting

**`InvalidIdentityToken` from STS:**
The OIDC provider is not registered in IAM, or the
registered client ID does not match the token's audience.
Verify the provider exists and includes `openshift` in its
client ID list:

```bash
aws iam list-open-id-connect-providers
```

If missing, register it (see [Register the OIDC
provider](#register-the-oidc-provider) above).

**Proxy blocks STS traffic:**
Check the proxy logs for `blocked CONNECT to unknown
domain`. If `sts.amazonaws.com` is blocked, the credential
entry uses a domain that is too narrow. Use
`.amazonaws.com` to cover both S3 and STS endpoints.

**Pod stays Pending:**
The ServiceAccount does not exist in the namespace.
Check `oc get sa -n <namespace>` and create it if
missing. This is standard Kubernetes behavior.

**`169.254.169.254` blocked in proxy logs:**
This is the EC2 instance metadata service. The proxy
correctly blocks it — agents should not access node-level
credentials. IRSA provides credentials via the projected
token instead.

## References

- [Upstream operator PR #240: serviceAccountName][upstream-pr]
- [AWS IRSA documentation][irsa]
- [Agent backup and restore (static keys)](agent-backup-restore.md)
- [Custom agent image](custom-agent-image.md)
- [Proxy security FAQ](proxy-security-faq.md)

[upstream-pr]: https://github.com/codeready-toolchain/claw-operator/pull/240
[irsa]: https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
[rclone]: https://rclone.org/
[rclone-providers]: https://github.com/rclone/rclone#storage-providers
