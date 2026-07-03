# Working with Claw Collections

A *collection* is a directory tree (agent files, skills, MCP servers,
cron) that seeds the Claw's workspace on first boot. Collections live
in the
[claw-collections](https://github.com/redhat-et/claw-collections)
repo and provide reusable, preconfigured workspace bundles.

## Seed a new Claw from a collection

Seeding requires **Config owner = User** and is a **create-time**
choice (locked once the Claw exists).

**Upload the `software-qa-mcp` example:**

1. Fill in name, provider, and credentials as described in the
   [Deployer Guide](deployer-guide.md).
1. **Config owner** → **User**.
1. **OpenClaw workspace source** → **Upload a folder**, and pick
   `claw-collections/software-qa-mcp` from your local clone
   (uploads cap at 1 MiB).
1. Click **Create**.

> Prefer Git? Choose **Git repository** instead:
> URL `https://github.com/redhat-et/claw-collections.git`, ref
> `main` (branch or tag — not a SHA), path `software-qa-mcp`.

## Create your own collection

Build your own bundle as a directory tree, then seed a new
**User**-managed Claw from it (Upload, or your own Git repo).

Layout:

```none
my-collection/
├── workspace-main/          → ~/.openclaw/workspace/
│   ├── AGENTS.md            # Agent identity and instructions
│   ├── SOUL.md              # Tone and policy guidelines
│   └── skills/              # Custom skills
│       └── my-skill/
│           └── SKILL.md
├── openclaw.json            # Merged into the Claw's config
└── other-dir/               # Copied under ~/.openclaw/
```

- `workspace-main/` maps to `~/.openclaw/workspace/` (AGENTS.md,
  SOUL.md, skills/, etc.)
- `openclaw.json` is merged into the Claw's config (agents, MCP
  servers, cron)
- Any other top-level folder is copied under `~/.openclaw/`

See the
[claw-collections README](https://github.com/redhat-et/claw-collections)
for the full layout specification and the `software-qa-mcp/` example
for working wiring.

## Collections in enterprise deployments

For deploying collections at scale via GitOps, see:

- [Enterprise Onboarding Workflows](enterprise-onboarding-workflows.md)
  — Scenario B shows per-department collections deployed via Argo CD
- [Enterprise Deployment Design](dev/enterprise-deployment-design.md)
  — OCI-based skill delivery for supply chain integrity
