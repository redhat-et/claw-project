# Custom agent image

The upstream OpenClaw container includes basic tools (`curl`,
`git`, `python3`) but lacks utilities that agents commonly
need for data processing — `jq`, `yq`, and others. Because the
operator's proxy restricts network access and the container
runs without root, these tools cannot be installed at runtime.

This guide covers building a custom agent image that layers
additional CLI tools on top of the upstream OpenClaw image.

## How it works

A thin `Containerfile` in `image/` extends the upstream image
with additional packages. A GitHub Actions workflow rebuilds
and pushes the image automatically.

```text
┌─────────────────────────────┐
│  quay.io/.../openclaw-agent │  ← your custom image
├─────────────────────────────┤
│  + jq, yq, ...             │  ← tools layer (~5 MB)
├─────────────────────────────┤
│  ghcr.io/.../openclaw       │  ← upstream OpenClaw
└─────────────────────────────┘
```

## Adding or removing tools

Edit `image/Containerfile`:

- **Apt packages** (available in Debian Bookworm repos) — add
  to the `apt-get install` line
- **Static binaries** (not in repos) — add a `curl` + `chmod`
  block, following the `yq` example in the file. Always
  pin the version and verify the SHA-256 checksum.

Push to `main` and the GitHub Actions workflow rebuilds
the image.

## Build triggers

The GitHub Actions workflow
(`.github/workflows/build-agent-image.yaml`) runs on three
triggers:

| Trigger | When | Use case |
| ------- | ---- | -------- |
| Push to `image/**` | Automatic on merge | Tool list changed |
| Manual dispatch | On demand | Pin to a specific upstream release |
| Weekly schedule | Monday 06:07 UTC | Pick up upstream updates |

The workflow auto-detects the upstream OpenClaw version from
the image's `org.opencontainers.image.version` OCI label and
tags the output image accordingly (e.g. `2026.6.11`,
`2026.6.11-20260708`, `latest`).

## Building locally

```bash
podman build -t openclaw-agent:dev image/
```

Verify the tools are available:

```bash
podman run --rm openclaw-agent:dev sh -c "jq --version && yq --version && rclone --version"
```

To pin to a specific upstream version:

```bash
podman build \
  --build-arg UPSTREAM=ghcr.io/openclaw/openclaw:2026.6.11 \
  -t openclaw-agent:dev image/
```

## Deploying the custom image

Set `spec.image` in the Claw CR to point to your custom image:

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: my-agent
spec:
  image: quay.io/<myorg>/openclaw-agent:2026.6.11
  # ... rest of the spec
```

> [!NOTE]
> Full `spec.image` support is currently available in the
> [upstream operator][upstream-op] only. The `redhat-et` fork
> does not yet support this field. Track progress in the
> fork's issue tracker.

[upstream-op]: https://github.com/openclaw/openclaw-operator

## CI prerequisites

Before the first build, update `env.IMAGE_NAME` in
`.github/workflows/build-agent-image.yaml` to match your
Quay.io organization and repository name.

The workflow requires two repository secrets:

| Secret | Value |
| ------ | ----- |
| `QUAY_USERNAME` | Quay.io robot account username |
| `QUAY_PASSWORD` | Quay.io robot account token |

Create a [robot account][quay-robots] in your Quay.io
repository with **Write** permission, then add its credentials
as GitHub Actions secrets.

[quay-robots]: https://docs.quay.io/glossary/robot-accounts.html

## Tools included

| Tool | Source | Purpose |
| ---- | ------ | ------- |
| `jq` | Debian apt | JSON parsing and transformation |
| `yq` | Static binary | YAML parsing (mirrors `jq` for YAML) |
| `rclone` | Static binary | Backup/restore agent workspaces to S3, GCS, etc. |

Tools already present in the upstream image: `curl`, `git`,
`python3`, `openssl`, `ca-certificates`, `tini`.

## Tools evaluated but not included

[Issue #69][issue] lists additional tools that were evaluated
and deferred:

| Tool | Status | Reason |
| ---- | ------ | ------ |
| `rg` (ripgrep) | Deferred | Not yet needed in agent workflows; can be added later |
| `gh` (GitHub CLI) | Blocked | `gh` authenticates via `GITHUB_TOKEN` or `~/.config/gh/hosts.yml`, neither of which integrates with the Claw proxy's credential injection model. See [#69][issue] for possible workarounds (proxy passthrough, projected Secret, wrapper script). |

## References

- [Issue #69 — CLI tool availability audit][issue]
- [Containerfile](../image/Containerfile)
- [Build workflow](../.github/workflows/build-agent-image.yaml)

[issue]: https://github.com/redhat-et/claw-project/issues/69
