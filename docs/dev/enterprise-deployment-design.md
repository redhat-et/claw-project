# Enterprise Multi-User Deployment Design

Design sketch for deploying per-user Claw instances on a shared
OpenShift cluster with ITOps-controlled skills, locked-down
registries, and shared credentials.

## Goals

- **Reduce friction:** Business users (HR, finance, sales) get a
  working AI assistant without understanding Kubernetes
- **ITOps control:** Skills, credentials, and network access are
  managed centrally
- **Security:** Block public skill/plugin registries; only allow
  corporate-approved sources
- **Scalability:** Shared infrastructure (credentials, skills) across
  many instances without duplication

## Current operator capabilities (no changes needed)

| Capability           | How it works                                                         |
| -------------------- | -------------------------------------------------------------------- |
| Multi-instance       | Multiple Claw CRs in the same namespace, isolated by instance labels |
| Shared credentials   | Multiple CRs reference the same Kubernetes Secret                    |
| Inline skills        | `spec.skills` injects SKILL.md content directly in the CR            |
| Workspace templating | `spec.workspace.files` seeds AGENTS.md, SOUL.md from a template      |
| Idle management      | `spec.idle: true` scales to zero for unused instances                |
| Version pinning      | `spec.version` overrides the OpenClaw image tag per-instance         |

## Proposed features

### Feature A: OCI image-based skill delivery

**Problem:** `spec.skills` embeds skill content inline in the CR,
which doesn't scale for large skills or skills shared across dozens
of instances. More critically, inline skills have no provenance
(who authored them?), no integrity guarantee (was the content
modified after deployment?), and no versioning (which version is
running?).

Skills are applications. They should be treated as such: authored,
versioned, signed, distributed through registries, and deployed
immutably.

**Context:** The [skillimage](https://github.com/redhat-et/skillimage)
project provides the supply chain:

- `skillctl build` packages SKILL.md + SkillCard metadata into OCI
  images
- `skillctl push` publishes to any OCI registry (Quay, GHCR, Zot)
- Lifecycle management: draft → testing → published → deprecated
- Metadata stored in OCI manifest annotations (inspectable without
  download)
- Signature verification via cosign/sigstore (planned)
- Dual format: OCI artifact for individual users, OCI image for
  platform ImageVolume mounts

**Solution:** Add `spec.skillImages` — a list of OCI image
references that the operator mounts as read-only skills via
Kubernetes ImageVolumes.

```yaml
spec:
  skillImages:
    - name: resume-screener
      image: quay.io/corp-skills/resume-screener:1.0.0-image
    - name: sales-playbook
      image: quay.io/corp-skills/sales-playbook:2.1.0-image
```

**Behavior:**

- Skills are mounted **read-only** via ImageVolume — content is
  immutable, verified by digest, and managed by kubelet. Users
  cannot modify them.
- The OCI image must be in skillimage's "image" format (single
  tar+gzip layer with SKILL.md at the root). The `-image` tag
  suffix is the convention.
- ITOps updates the image tag in the CR; the operator triggers a
  pod restart to pick up the new version.
- Conflicts with `spec.skills` (same name), builtin skills
  (`platform`, `kubernetes`), and other `skillImages` entries
  should be rejected at validation time.

**Three mounting strategies** (by OpenShift version):

| Strategy            | OpenShift | Integrity    | How it works                                                       |
| ------------------- | --------- | ------------ | ------------------------------------------------------------------ |
| ImageVolume         | 4.20+     | Full         | Kubelet mounts OCI image as read-only volume at `/skills/<name>/`  |
| Init container pull | Any       | At pull time | `skillctl pull` in init container → writes to PVC                  |
| ConfigMap flatten   | Any       | None         | Read OCI at reconcile time → write `_skill_*` keys (fallback only) |

**Recommended: ImageVolume** (OpenShift 4.20+ / Kubernetes 1.33+).
This is the only strategy that provides a full integrity guarantee —
the content is mounted directly from the OCI image layer, verified
by digest, and never written to a mutable filesystem.

**Implementation: `extraDirs` + ImageVolume mounts**

OpenClaw natively supports multiple skill directories via the
`skills.load.extraDirs` config field (defined in
`src/config/types.skills.ts`). Skills from `extraDirs` are
discovered at startup and merged with workspace skills (workspace
skills take precedence on name collision).

The operator mounts each skill image at `/skills/<name>/` and
injects `skills.load.extraDirs: ["/skills"]` into `operator.json`.
OpenClaw scans `/skills/` on startup and discovers all mounted
skill images automatically. No symlinks, no init container copies,
no `merge.js` changes needed.

```yaml
# What the operator generates in the Deployment spec:
volumes:
  - name: skill-resume-screener
    image:
      reference: quay.io/corp/skill-resume:1.0.0-image
      pullPolicy: IfNotPresent
  - name: skill-sales-playbook
    image:
      reference: quay.io/corp/skill-sales:2.1.0-image
      pullPolicy: IfNotPresent

# Gateway container:
volumeMounts:
  - name: skill-resume-screener
    mountPath: /skills/resume-screener
    readOnly: true
  - name: skill-sales-playbook
    mountPath: /skills/sales-playbook
    readOnly: true
```

```jsonc
// What the operator injects into operator.json:
{
  "skills": {
    "load": {
      "extraDirs": ["/skills"]
    }
  }
}
```

**Why this works:**
- ImageVolumes mount at a top-level path (`/skills/`) — no conflict
  with the PVC at `/home/node/.openclaw`
- OpenClaw's `extraDirs` scans `/skills/` and discovers each
  subdirectory containing a `SKILL.md`
- Content is read-only, digest-verified, kubelet-managed
- No symlinks needed (OpenClaw's symlink validation would actually
  *reject* cross-root symlinks via `resolveContainedSkillPath()`)
- Workspace skills at `workspace/skills/` still take precedence,
  so users can override an `extraDirs` skill with a workspace copy

**OpenClaw skill precedence chain** (lowest → highest):
bundled (`/app/skills/`) → extraDirs (`/skills/`) → managed
(`~/.openclaw/skills/`) → personal (`~/.agents/skills/`) →
workspace (`workspace/skills/`)

**Bundled skills note:** OpenClaw also has built-in skills at
`/app/skills/` (overridable via `OPENCLAW_BUNDLED_SKILLS_DIR`).
These are read-only in the container image and have the lowest
precedence. The operator could also mount skills there, but
`extraDirs` is more flexible — it supports multiple directories
and doesn't interfere with OpenClaw's built-in skills.

**Fallback for older OpenShift:** For clusters without ImageVolume
support, the operator can fall back to an init container that runs
`skillctl pull` to extract skill content onto the PVC. This uses
the skillimage artifact format (not the image format). The operator
would add a `skillctl` init container before `init-config`:

```yaml
initContainers:
  - name: init-skills
    image: ghcr.io/redhat-et/skillctl:latest
    command: ["sh", "-c", "skillctl pull -o /skills quay.io/corp/resume-screener:1.0.0"]
    volumeMounts:
      - name: claw-home
        mountPath: /skills
        subPath: home/workspace/skills
```

**Supply chain integration:**

```none
Developer                   Registry              Claw Operator
─────────                   ────────              ─────────────
writes SKILL.md
+ skill.yaml
    │
skillctl build
skillctl push ──────────→  quay.io/corp/
                           skill-resume:1.0.0
    │
cosign sign ─────────────→ signature stored
                           alongside image
                                │
                    ITOps updates Claw CR:
                    spec.skillImages:
                      - name: resume-screener
                        image: quay.io/.../1.0.0-image
                                │
                           Operator reconciles:
                           adds ImageVolume +
                           volumeMount to Deployment
                                │
                           Kubelet pulls + mounts
                           (digest verified)
                                │
                           OpenClaw discovers skill
                           via extraDirs: ["/skills"]
                           at startup
```

### Feature A-fallback: Skill refs from ConfigMaps

For skills that don't need provenance guarantees (small internal
snippets, per-department customizations), ConfigMap-based skill
refs remain useful as a simpler alternative:

```yaml
spec:
  skillRefs:
    - configMapRef:
        name: corp-quick-skills
      # All keys in the ConfigMap become skills.
      # Key "sales-playbook" → skills/sales-playbook/SKILL.md
```

Implementation: Read the referenced ConfigMap at reconcile time
and add its keys as `_skill_*` entries in the gateway ConfigMap.
Matches the existing pattern used by `spec.skills`. Subject to
the 1MB ConfigMap size limit.

### Feature B: Configurable passthrough domains

**Problem:** The proxy has hardcoded builtin passthrough domains
(clawhub.ai, registry.npmjs.org, github.com, etc.) that cannot be
disabled. On locked-down enterprise clusters, ITOps needs to block
public registries and replace them with internal mirrors.

**Solution:** Add `spec.network.builtinPassthroughs` to control
which builtin domains are allowed.

```yaml
spec:
  network:
    builtinPassthroughs:
      # Explicitly list which builtins to keep.
      # Omitted builtins are blocked.
      - clawhub.ai        # keep: needed for ClawHub skills
      - github.com         # keep: needed for git clones
      # registry.npmjs.org  — blocked: use internal mirror
      # openrouter.ai       — blocked: not needed
```

**Alternative — blocklist approach:**

```yaml
spec:
  network:
    disableBuiltinPassthroughs:
      - clawhub.ai
      - registry.npmjs.org
```

**Trade-off:** The allowlist approach (first example) is more secure
by default — new builtins added in future operator versions won't
automatically become available. The blocklist approach is more
convenient — existing setups keep working when new builtins are
added. For an enterprise-focused feature, the **allowlist** is
probably the right default.

**To replace blocked registries** with internal mirrors, ITOps adds
`type: none` credential entries:

```yaml
spec:
  credentials:
    # Internal npm registry mirror
    - name: internal-npm
      type: none
      domain: npm.corp.internal
    # Internal skill registry
    - name: internal-skills
      type: none
      domain: skills.corp.internal
```

**Implementation approach:**

The `builtinPassthroughDomains` variable in `claw_proxy.go` is
currently a package-level `var`. The `generateProxyConfig` function
iterates over it unconditionally. Changes needed:

1. Pass the Claw instance's network config into `generateProxyConfig`
1. Filter `builtinPassthroughDomains` against the allowlist before
   generating routes
1. When `spec.network.builtinPassthroughs` is nil (not set), preserve
   current behavior (all builtins allowed) for backward compatibility

### Feature C: Shared credential management (already works)

No operator changes needed. Multiple Claw CRs in the same namespace
can reference the same Secret:

```yaml
# Shared by all users in the namespace
apiVersion: v1
kind: Secret
metadata:
  name: vertex-sa-key
  namespace: ai-assistants
data:
  sa-key.json: <base64-encoded service account>
---
# HR user
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: hr-assistant
spec:
  credentials:
    - name: anthropic-vertex
      type: gcp
      provider: anthropic
      gcp:
        project: corp-ai-project
        location: global
      secretRef:
        - name: vertex-sa-key      # shared Secret
          key: sa-key.json
  skills:
    hr-policy: |
      ---
      name: hr-policy
      description: "HR policy lookup"
      ---
      # HR Policy Access
      You have access to corporate HR policies...
---
# Sales user
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: sales-assistant
spec:
  credentials:
    - name: anthropic-vertex
      type: gcp
      provider: anthropic
      gcp:
        project: corp-ai-project
        location: global
      secretRef:
        - name: vertex-sa-key      # same shared Secret
          key: sa-key.json
  skillRefs:                        # shared skills from ConfigMap
    - configMapRef:
        name: corp-sales-skills
```

### Feature D: User provisioning (outside the operator)

The operator manages infrastructure per-CR. User provisioning — who
gets an instance, what template to use, how to present the URL — is
application-level concern. Options:

| Approach                  | Complexity | Fits when                               |
| ------------------------- | ---------- | --------------------------------------- |
| GitOps (Argo CD/Flux)      | Low        | Users are developers who can submit PRs |
| Self-service portal       | Medium     | Business users who need a web UI        |
| Namespace-per-user + RBAC | Low        | Users create their own CRs with quotas  |
| Helm chart with values    | Low        | Standardized deployments via CI/CD      |

For business users, a **self-service portal** that creates Claw CRs
from a template and displays the gateway URL is the lowest-friction
option. The portal would:

1. Create a Claw CR from a department-specific template
1. Poll `status.conditions` until `Ready=True`
1. Display `status.gatewayURL` to the user
1. Optionally manage idle/resume lifecycle

### Feature E: Persona configuration modes

**Problem:** The operator embeds persona content (AGENTS.md, SOUL.md,
BOOTSTRAP.md) as plain text in the gateway ConfigMap. All instances
get the same persona. For multi-user deployments, different
departments need different personas, and power users want full
control without operator-imposed defaults.

**Solution:** Add `spec.persona.mode` with three modes that form a
spectrum from most controlled to most flexible.

**Mode 1 — `managed` (default, current behavior)**

The operator injects its built-in AGENTS.md, SOUL.md, BOOTSTRAP.md.
Optionally, a ConfigMap ref overrides the defaults:

```yaml
spec:
  persona:
    mode: managed               # default
    configMapRef:
      name: sales-persona       # optional override
    # Keys in the ConfigMap replace the built-in persona files:
    # AGENTS.md, SOUL.md, BOOTSTRAP.md, IDENTITY.md, USER.md
```

When `configMapRef` is set, the operator reads the ConfigMap at
reconcile time and uses its keys instead of the built-in defaults.
Keys map to workspace files with seed-once semantics (users can
customize after first boot). Infrastructure content (PLATFORM.md,
KUBERNETES.md) is still operator-managed regardless.

This enables per-department personas: create a `sales-persona`
ConfigMap, reference it from all sales Claw CRs. Update the
ConfigMap to roll out persona changes across all sales instances.

**Mode 2 — `image` (OCI persona bundle)**

Package the full persona as a signed OCI image:

```yaml
spec:
  persona:
    mode: image
    image: quay.io/corp/sales-persona:1.2.0
```

The persona image contains AGENTS.md, SOUL.md, BOOTSTRAP.md, and
optionally skills. Mounted via ImageVolume (OpenShift 4.20+) or
pulled via init container (older versions).

Advantages over ConfigMap: versioned, signed via cosign, immutable
at runtime, distributable via registry. Uses the same skillimage
OCI format and supply chain.

The init-config script copies persona files from the mount point
into the workspace with seed-once semantics. Infrastructure
content (PLATFORM.md, KUBERNETES.md) is still injected by the
operator.

**Mode 3 — `unmanaged` (infrastructure only)**

The operator provides only the infrastructure layer — no persona
injection at all:

```yaml
spec:
  persona:
    mode: unmanaged
```

What the operator **still manages** in unmanaged mode:
- Gateway Secret, proxy CA, proxy ConfigMap
- Deployments, Services, Routes, NetworkPolicies
- `operator.json` infrastructure keys (gateway.port, gateway.auth,
  models.providers, etc.)
- Credential injection, MCP servers, web search
- PLATFORM.md and KUBERNETES.md (the assistant still needs to know
  about the proxy and cluster access)

What the operator **skips** in unmanaged mode:
- AGENTS.md, SOUL.md, BOOTSTRAP.md, IDENTITY.md injection
- `skipDefaultPersonality` config injection
- Bootstrap hook injection (`hooks.internal.entries.bootstrap-extra-files`)
- `merge.js` workspace file seeding (except operator-managed skills)

The user gets a bare OpenClaw instance and configures persona
themselves via the UI, `openclaw config patch`, or workspace files
— the same experience as a native OpenClaw install, but with the
proxy security boundary intact.

**Implementation approach:**

The current `enrichConfigAndNetworkPolicy` function in
`claw_resource_controller.go` tangles infrastructure and persona
injection. The refactor:

1. Add `PersonaSpec` type to `claw_types.go`:
   ```go
   type PersonaMode string
   const (
       PersonaModeManaged   PersonaMode = "managed"
       PersonaModeImage     PersonaMode = "image"
       PersonaModeUnmanaged PersonaMode = "unmanaged"
   )
   type PersonaSpec struct {
       Mode         PersonaMode `json:"mode,omitempty"`
       ConfigMapRef *corev1.LocalObjectReference `json:"configMapRef,omitempty"`
       Image        string `json:"image,omitempty"`
   }
   ```

1. Guard persona injection in `enrichConfigAndNetworkPolicy`:
   - `skipDefaultPersonality()` — skip when unmanaged
   - `injectBootstrapHook()` — skip when unmanaged
   - `merge.js` seeding of AGENTS.md, SOUL.md, BOOTSTRAP.md — skip
     when unmanaged; use ConfigMap content when configMapRef is set

1. For `image` mode: add ImageVolume mount (same pattern as
   `spec.skillImages`) at `/persona/`, add init-config step to
   copy persona files from `/persona/` into workspace.

**Build order:**

| Order | What | Difficulty | Depends on |
|-------|------|-----------|-----------|
| 1 | `unmanaged` mode | Low (remove code paths behind a flag) | Nothing |
| 2 | `managed` + `configMapRef` | Medium (read ConfigMap, inject keys) | Unmanaged (code separation) |
| 3 | `image` mode | Medium (ImageVolume mount) | Feature A + configMapRef |

Unmanaged mode is foundational because it establishes the separation
between infrastructure (always operator-managed) and persona
(optionally user-managed). Once that separation exists, ConfigMap
refs and OCI images slot in cleanly as persona sources.

## Implementation priority

| Feature                         | Difficulty  | Impact                        | Suggested order          |
| ------------------------------- | ----------- | ----------------------------- | ------------------------ |
| B. Configurable passthroughs    | Low         | High (security gate)          | First                   |
| E1. Persona unmanaged mode      | Low         | High (unlocks power users)    | Second                  |
| E2. Persona ConfigMap refs      | Medium      | High (per-dept customization) | Third                   |
| A. OCI skill images             | Medium-High | High (skill supply chain)     | Fourth                  |
| E3. Persona OCI images          | Medium      | Medium (signed personas)      | With or after A         |
| A-fallback. ConfigMap skillRefs | Low         | Medium (simple skill sharing) | With or after A         |
| D. User provisioning portal     | Medium      | High (user experience)        | Last (separate project) |

**Recommended build order rationale:**

Feature B (passthroughs) is the security prerequisite — blocks
public registries. E1 (unmanaged mode) separates infrastructure
from persona in the codebase, which E2 and E3 depend on. E2
(ConfigMap persona refs) gives ITOps per-department customization
immediately. Feature A (OCI skills) and E3 (OCI personas) build
on the ImageVolume pattern and the skillimage supply chain. Feature
D is a separate application that consumes the operator's API.

## Open questions

1. **OpenShift version:** ImageVolumes require OpenShift 4.20+
   (Kubernetes 1.33+). What version is the target cluster running?
   This determines whether the ImageVolume strategy is available or
   the init container fallback is needed.

1. **Per-user credentials vs shared:** Should each user get their own
   API key (for cost attribution) or share a team key? The operator
   supports both — separate Secrets per user or shared Secrets across
   CRs.

1. **Namespace strategy:** One namespace for all users (simpler RBAC,
   shared Secrets) or namespace-per-user (stronger isolation, more
   operational overhead)?

1. **Signature verification enforcement:** Should the operator
   verify cosign signatures on skill images before mounting them?
   This would add a hard guarantee that only signed skills from
   trusted publishers can run. Implementation options:
   - Operator-level: verify at reconcile time (reject unsigned
     images with a status condition error)
   - Cluster-level: use Kyverno/Gatekeeper policies to enforce
     image signatures on pod admission
   - Both: defense-in-depth

1. **Skill discovery path:** ~~Does OpenClaw support multiple skill
   directories?~~ **Resolved.** Yes — `skills.load.extraDirs` in
   config accepts an array of additional scan paths. The operator
   injects `extraDirs: ["/skills"]` and mounts ImageVolumes there.
   No symlinks needed.

1. **skillctl as operator dependency:** Should the operator embed
   `skillctl` for the init container fallback, or should it be a
   separate image that the operator references (like `PROXY_IMAGE`
   and `KUBECTL_IMAGE`)? A `SKILLCTL_IMAGE` env var would follow
   the existing pattern.
