# Claw Project

A platform for running OpenClaw AI assistants at scale on OpenShift.
This repo is the central hub for issues, documentation, and
cross-project coordination. No code lives here — open issues at
[github.com/redhat-et/claw-project/issues](https://github.com/redhat-et/claw-project/issues).

## What we're building

A set of workflows for deploying and managing OpenClaw instances for
different kinds of users. A cluster admin deploys multiple instances
using preconfigured templates from claw-collections via a GitOps
approach, controlling how much freedom each user gets — from a
completely locked-down kiosk to full self-service.

## User personas

| Persona           | What they do                                                                   | Where to start                                                                |
| ----------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **Cluster Admin** | Deploys instances via GitOps, sets security policies, manages credentials      | [Enterprise Onboarding Workflows](docs/enterprise-onboarding-workflows.md)    |
| **Power User**    | Self-manages their OpenClaw with full control over persona, skills, and models | [Deployer Guide](docs/deployer-guide.md)                                      |
| **Business User** | Uses a curated assistant (HR, Sales, etc.) preconfigured by admin              | [Enterprise Onboarding](docs/enterprise-onboarding-workflows.md) (Scenario B) |
| **Developer**     | Codes with OpenClaw, customizes workspace, creates collections                 | [Collections Guide](docs/collections-guide.md)                                |

## The management spectrum

The `spec.config.management` field on every Claw CR controls how
much freedom the user has:

```none
user                                                     operator
├─────────────────────────────────────────────────────────────┤
Full freedom                                      Fully locked down
Power users                                       Regulated kiosks
User edits persist                       Operator reconciles on restart
```

| Mode       | User can                                                   | Admin controls                                        | Best for                               |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| `user`     | Modify persona, install skills, change models, add plugins | Credentials, network egress, proxy boundary           | Developers, power users                |
| `operator` | Use the assistant as configured                            | Everything: persona, skills, models, network, plugins | Business users, regulated environments |

In between, admins combine mode with network policies, read-only
persona mounts, and skill allowlists to fine-tune the control level.
See [Scenario F](docs/enterprise-onboarding-workflows.md#scenario-f-locked-down-kiosk-with-guardrails)
for the most restrictive example.

## Repos

Clone these so your local AI can read them and guide you, and so
you can fix and contribute:

| Repo                        | Clone                                                                                                | What it is                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **openclaw**                | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)                                 | The OpenClaw agent — config, skills, plugins, the Control UI      |
| **claw-operator**           | [github.com/redhat-et/claw-operator](https://github.com/redhat-et/claw-operator)                     | The OpenShift operator — defines the `Claw` CR, manages instances |
| **claw-operator-dashboard** | [github.com/redhat-et/claw-operator-dashboard](https://github.com/redhat-et/claw-operator-dashboard) | The Deployer web app and admin dashboard                          |
| **claw-collections**        | [github.com/redhat-et/claw-collections](https://github.com/redhat-et/claw-collections)               | Reusable workspace bundles (collections) and examples             |
| **claw-project**            | [github.com/redhat-et/claw-project](https://github.com/redhat-et/claw-project)                       | This hub — issues and documentation                               |

## Documentation

### Getting started

Step-by-step scenario walkthroughs — start here.

| Guide | What you'll build |
| ----- | ----------------- |
| [Your first AI assistant](docs/scenarios/scenario-a-shared-team.md) | Personal instance, then a shared team setup |
| [Registry lockdown](docs/scenarios/scenario-c-registry-lockdown.md) | Block public registries, use internal mirrors |
| [Locked-down kiosk](docs/scenarios/scenario-f-kiosk-guardrails.md) | Regulated environment with strict guardrails |

Per-department profiles (Scenario B) and autonomous agent
(Scenario E) walkthroughs are planned. See
[all scenarios](docs/scenarios/) for the full list.

### Operations guide

Recommended practices for running OpenClaw well. See the
[operations guide](docs/operations-guide.md) for the full
index.

| Topic | Status |
| ----- | ------ |
| [GitOps deployment with ArgoCD](docs/gitops-setup.md) | Available |
| [Git-based change tracking](docs/git-change-tracking.md) | Available |
| Cost attribution, secret management, upgrades, monitoring | Planned |

### Reference

Deep-dive material for evaluation, architecture, and
customization.

| Document | Description |
| -------- | ----------- |
| [Enterprise onboarding workflows](docs/enterprise-onboarding-workflows.md) | Six deployment scenarios — overview and CRD gap analysis |
| [Operator technical brief](docs/operator-technical-brief.md) | Architecture, security model, and operational characteristics |
| [Collections guide](docs/collections-guide.md) | Creating and using preconfigured workspace bundles |
| [Deployer guide](docs/deployer-guide.md) | Using the web app to manage OpenClaw instances |

### Design docs

| Document | Description |
| -------- | ----------- |
| [Enterprise deployment design](docs/dev/enterprise-deployment-design.md) | Proposed features: OCI skill delivery, configurable passthroughs, persona modes |
| [Business users configuration](docs/dev/business-users-configuration.md) | Configuration strategies for locked-down business user instances |
