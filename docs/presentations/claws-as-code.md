---
marp: true
theme: redhat-dark
paginate: true
header: ""
footer: "Red Hat — Claws-as-Code"
---

<!-- _class: section-title -->

# <span class="accent">Claws-as-Code</span>

Declarative AI Assistants on OpenShift

Pavel Anni · Office of the CTO · Red Hat
June 2026

<span class="tag">openclaw</span> <span class="tag">openshift</span> <span class="tag">agentic-infra</span>

---

# The <span class="accent">Problem</span>

- AI assistants proliferating across the enterprise
- Each needs **credentials**, **persona**, **security boundaries**
- Ad-hoc provisioning: copy-paste configs, hope nobody leaks a key
- No audit trail, no rollback, no governance at scale

<!--
Every team wants their own AI assistant. Without a platform
approach, each one is a snowflake — manually provisioned,
ungoverned, unauditable. This doesn't scale.
Timing: ~45s
-->

---

<!-- _class: section-title -->

# We Already <span class="accent">Solved</span> This

Infrastructure as Code — one manifest, version-controlled,
reviewed in PRs, deployed by a controller.

Why not AI assistants?

---

# <span class="accent">Claws-as-Code</span>: One Manifest

```yaml
apiVersion: claw.sandbox.redhat.com/v1alpha1
kind: Claw
metadata:
  name: dev-team
spec:
  credentials:
    - name: anthropic
      provider: anthropic
      secretRef:
        - name: team-anthropic
          key: api-key
  agentFiles:
    git:
      url: github.com/redhat-et/claw-collections
      path: enterprise-profiles/shared-team
```

<!--
This is all it takes. The operator handles networking,
proxy, persistence, and security. Point agentFiles at
the claw-collections repo to seed the persona.
Timing: ~60s
-->

---

# Personas in <span class="accent">Markdown</span>

```markdown
You are a financial analysis assistant
for a corporate finance team.

## Principles
- Precision is non-negotiable
- Present numbers with context
- Distinguish facts from projections

## Hard constraints
- NEVER fabricate financial data
- NEVER provide investment advice
```

*claw-collections/enterprise-profiles/financial-analyst*

<!--
Persona definition — human-readable, version-controlled,
reviewable in a PR. SOUL.md defines who the agent is.
AGENTS.md and TOOLS.md define what it can do.
Timing: ~45s
-->

---

# The Management <span class="accent">Spectrum</span>

```text
  User-managed                              Operator-managed
  ◄─────────────────────────────────────────────────────────►
  │         │              │         │              │
  D         A              B         C          E   F
  Personal  Shared team    Dept      Lockdown   Auto Kiosk
```

Same platform, same manifest shape — one field controls the dial.

<!--
spec.config.management controls freedom vs. control.
The six deployment scenarios sit along this spectrum.
Timing: ~60s
-->

---

# Security by <span class="accent">Design</span>

```text
User → Gateway (no keys) → MITM Proxy → Provider API
                              ↑
                        K8s Secrets inject
                        credentials here
```

- Gateway **never sees** real API keys
- Unknown domains **blocked** (HTTP 403); TLS enforced
- Persona files mounted **read-only** — malicious skills
  can't alter the agent's own constraints

<!--
The proxy boundary is the core security model.
Even if an agent is compromised, it cannot access
credentials or modify its own governance files.
Timing: ~60s
-->

---

# Six <span class="accent">Scenarios</span>, One Platform

| Scenario | Use case | Key feature |
| -------- | -------- | ----------- |
| **D** | Personal dev | Minimal CR, full freedom |
| **A** | Shared team | Git-seeded persona |
| **B** | Per-department | HR, Finance, Marketing |
| **C** | Enterprise lockdown | Registry mirrors, cost tracking |
| **E** | Autonomous agent | No human, queue-driven |
| **F** | Regulated kiosk | Read-only persona, no network |

<!--
From a developer's personal assistant to a locked-down
finance kiosk — same operator, same manifest shape.
Timing: ~45s
-->

---

# <span class="accent">claw-collections</span>

```text
claw-collections/
├── enterprise-profiles/
│   ├── financial-analyst/   # SOUL + AGENTS + TOOLS
│   ├── hr-specialist/
│   ├── marketing-specialist/
│   └── shared-team/
├── software-qa-mcp/         # MCP-backed + sub-agent
└── manifests/scenarios/      # Ready-to-deploy CRs
```

- Personas are **Markdown**, manifests are **YAML** — all in Git
- Fork, add your profile, deploy via **PR**
- Sub-agents supported (e.g., Docs Checker validates answers)

<!--
claw-collections is the reusable building blocks repo.
Teams fork it, add their department's profile, and
deploy through the same GitOps workflow.
Timing: ~45s
-->

---

# <span class="accent">GitOps</span> Workflow

1. **Author** persona Markdown + Claw CR in Git
2. **Review** persona changes in a PR — just like code
3. **Merge** → Argo CD syncs to cluster
4. **Deploy** → operator reconciles, pod starts with persona

Audit trail built in. Rollback is `git revert`.

<!--
Same workflow your customers already use for everything
on OpenShift. No new tools, no new processes.
Timing: ~45s
-->

---

# What's <span class="accent">Ready</span> Today

- Multi-instance deployment with **credential isolation**
- **Six scenarios** — personal dev to regulated kiosk
- **GitOps** with Argo CD
- Enterprise persona profiles (finance, HR, marketing, dev)
- **MCP server** integration
- Idle management, version pinning, **collections repo**
- Dashboard UI for **self-service** deployment

<!--
This is not a roadmap — these are shipped capabilities.
We can demo all six scenarios on a live cluster today.
Timing: ~45s
-->

---

# <span class="accent">Agentic</span> Infrastructure

- Currently working with **OpenClaw** — the most popular Claw
- Same operator, manifests, proxy, and collections
  can manage **other agents**: Hermes, ZeroClaw, and more
- Building a **platform layer** — not tied to one agent

<!--
The key message: we're not building for one agent.
We're building the infrastructure that deploys, governs,
and secures any AI assistant on OpenShift.
Timing: ~60s
-->

---

<!-- _class: section-title -->

# Get <span class="accent">Involved</span>

- **Project** — github.com/redhat-et/claw-project
- **Bundles** — github.com/redhat-et/claw-collections
- **Operator** — github.com/redhat-et/claw-operator

Deploy a Claw on your cluster in 5 minutes.

Contact: panni@redhat.com

---

<!-- _class: section-title -->

## Appendix: Future Deck Ideas

1. **"AI assistants need IaC governance"** —
   AI sprawl is coming; the IaC pattern is the right model
2. **"We have a unique approach"** —
   proxy credential isolation, management spectrum
3. **"How to pitch it to customers"** —
   talking points and objection handling for field teams
