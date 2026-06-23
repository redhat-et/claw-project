# Git-based change tracking for agent workspaces

Track changes to agent workspace Markdown files (SOUL.md,
AGENTS.md, USER.md, TOOLS.md, etc.) using Git. This gives
teams a full history of how agent configuration evolves,
with the ability to audit and revert changes.

## Problem

Power users and agents can modify the Markdown files that
define agent behavior. Without version control, those changes
are invisible and irreversible. An agent asked to "adjust your
persona" will edit SOUL.md — and there's no record of what
changed or how to undo it.

## Two approaches

### Agent-driven commits (cooperative)

Add a commit instruction to AGENTS.md so the agent commits
after every meaningful workspace change:

```markdown
## File change protocol

The workspace is a Git repository. After every meaningful
change to workspace Markdown files, commit the changes:

    git add -A && git commit -m "<what changed and why>"

Meaningful changes include: recording user preferences,
updating persona or procedures, adding or modifying skills.
```

This works when the agent follows instructions, but a user
can ask the agent to skip commits or edit files without
committing. **Use this for cooperative environments
(Scenarios A, D) where auditability is helpful but not
required.**

### Cron-based auto-commit (enforced)

For environments where tracking must be reliable regardless
of agent behavior, use a periodic job that commits
automatically:

```bash
# Run every 5 minutes via cron or a sidecar loop
cd /home/node/.openclaw/workspace
git add -A
git diff --cached --quiet || git commit -m "auto: $(date -Iseconds)"
```

This can be implemented as:

- A sidecar container in the gateway Deployment that runs a
  commit loop
- A cron entry in the init-config container's startup script
- A Kubernetes CronJob that exec's into the gateway pod

The auto-commit approach captures every change regardless of
whether the agent or user initiated it. **Use this for
regulated environments (Scenarios C, F) where audit trails
are required.**

## Setup

Initialize the workspace as a Git repo during first boot.
Add this to the init-config startup or as a post-seed step
in the agentFiles pipeline:

```bash
cd /home/node/.openclaw/workspace

if [ ! -d .git ]; then
  git config --global user.name "$(hostname)"
  git config --global user.email "agent@$(hostname).local"
  git init
  git add -A
  git commit -m "Initial commit: baseline workspace files"
fi
```

The agent's hostname (which includes the Claw instance name)
is used as the Git identity so commits are attributed per
agent.

## Viewing history and reverting changes

| Task | Command |
| ---- | ------- |
| View commit history | `git log --oneline` |
| See what changed in last commit | `git show HEAD` |
| Diff current state vs last commit | `git diff HEAD` |
| Revert a file to a prior state | `git checkout <hash> -- <file>` |
| Undo last commit (keep changes) | `git reset --soft HEAD~1` |

Run these by exec'ing into the gateway pod:

```bash
oc exec -n <namespace> <pod> -- \
  git -C /home/node/.openclaw/workspace log --oneline
```

## Integration with the Claw operator

The workspace lives on a PVC, so Git history survives pod
restarts. Key integration points:

- **init-config container** — the `git init` step should run
  after agentFiles seeding completes, so the baseline commit
  captures the seeded content
- **agentFiles.readOnly** — read-only files cannot be
  modified, so they won't generate Git diffs. Git tracking
  is most useful for the writable files (USER.md, MEMORY.md,
  user-created skills)
- **applyPolicy: Always** — when agentFiles re-seeds on
  every restart, the auto-commit captures the delta between
  the previous state and the fresh seed

## Open questions

1. **Remote push** — should workspace repos push to a remote
   (GitHub/GitLab) for off-cluster persistence, or is
   PVC-local history sufficient?
2. **Operator support** — should the Claw operator offer a
   `spec.workspace.gitTracking` field to enable this
   automatically, or keep it as a manual setup?
