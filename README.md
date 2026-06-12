# Claw Project

We are creating a platform for running OpenClaw agents at scale. Issues for all related repositories will go here, unless they are very strictly related to _only_ that repository. If they lend toward the platform as a whole, issues belong here. This is where we track everything. We do not put code in this repository. This repository is for Issues and Documentation. 

## The repos — clone these locally

Clone these so your local AI can read them and guide you, and so you can fix and contribute:

| Repo | Clone | What it is |
|---|---|---|
| **openclaw** | [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) | The OpenClaw agent itself — config, skills, plugins, the Control UI. |
| **claw-operator** | [https://github.com/redhat-et/claw-operator](https://github.com/redhat-et/claw-operator) | The OpenShift operator that runs Claws — defines the `Claw` CR and seeds collections. |
| **claw-operator-dashboard** | [https://github.com/redhat-et/claw-operator-dashboard](https://github.com/redhat-et/claw-operator-dashboard) | The deployer, which is a thin client for the operator. Also an admin dashboard. |
| **claw-collections** | [https://github.com/redhat-et/claw-collections](https://github.com/redhat-et/claw-collections) | Reusable workspace bundles ("collections") and examples like `software-qa-mcp`. |
| **claw-project** | [https://github.com/redhat-et/claw-project](https://github.com/redhat-et/claw-project) | This hub. **Found a bug or have a request? Open an issue here:** https://github.com/redhat-et/claw-project/issues |

# Using the OpenClaw Deployer

The **Deployer** is the OpenShift web app where you create or delete your OpenClaws.
Open its route URL, sign in with GitHub, and
it operates as *you* — you will only see your projects. Your namespace defaults to
`<your-login>-claw`. The deployer is designed to get you up and running fast. Once running, you can
interact with your OpenClaw to configure everything else.
It's a thin client around the Claw API, see the **claw-operator** to learn more.
Feel free to use the `Claw` Custom Resource directly instead of or after deploying with this deployer. 

You can view your Claw CRs with:

```
oc get claws -A
```

> [!NOTE]
> The Deployer defaults to setting `spec.config.management: user` .
> This gives direct access to your OpenClaw so you can modify it freely and natively through
> the OpenClaw Gateway and `openclaw` CLI.
> With `spec.config.management: operator`, claws are more locked down and reconciled,
> and to modify them you'd modify the CR instead of working with your agent directly.
> For exploration and development, use `management:user` 

## One-time setup: your Vertex service account

There is a dropdown of providers and most are simple "add your api key" but Vertex is
different. Create an SA provide its JSON key:

```sh
gcloud iam service-accounts create claw-vertex \
  --display-name="Claw Vertex AI"
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:claw-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=claw-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

You **paste the contents of `sa-key.json`** into the Deployer — it creates the
Kubernetes Secret for you.

> [!NOTE]
> Your OpenClaw agents do not have access to the secrets. 
> The operator keeps provider keys in Secrets and injects them through a per-Claw proxy
> that sits between the gateway and external APIs, so the agent itself never sees your
> raw API key (and for Vertex, the proxy vends GCP tokens on its behalf.

## Create an OpenClaw named **Fred** on Vertex (Claude), no model override

1. **Namespace** — your project (e.g. `<your-login>-claw`).
2. **OpenClaw name** — `fred` (becomes `Fred` in the UI).
3. **Provider** — `Google Vertex AI (Claude)`.
4. **Model override** — leave **blank** (uses `claude-sonnet-4-6`).
5. **GCP Project ID** and **GCP region** (`global`).
6. **Service Account Key** — paste your `sa-key.json` contents.
7. Click **Create**. When Fred is Ready, use **Open Control UI** to open the UI and talk to it.

## Add a provider/model to a running Claw (OpenRouter + Nemotron)

Once a Claw exists, the **Create** button becomes **Add/update provider**.

1. Select the same **Namespace** and **OpenClaw name** (`fred`).
2. **Provider** → `OpenRouter`.
3. **Model override** → `openrouter/nvidia/nemotron-3-ultra-550b-a55b`.
4. Paste your **OpenRouter API key** See [https://openrouter.ai](https://openrouter.ai/)
5. Click **Add/update provider**. The new provider key Secret is added; Fred can
   now use that model alongside Vertex. You can switch between them. Ask Fred, it'll tell you how.

## Restart and delete

- **Restart Fred** — click **Restart** on Fred's row (or the top Restart
  button) and confirm.
- **Delete Fred** — click **Delete** and confirm. This removes the Claw, its
  provider Secret(s), and any uploaded workspace ConfigMap. **The project
  (namespace) stays.** If you no longer need it, clean it up yourself:
  `oc delete project <your-namespace>`.

## Create a new Claw seeded from a claw-collection

A *collection* is a directory tree (agent files, skills, MCP servers, cron) that
seeds the Claw's workspace on first boot. Seeding requires **Config owner =
User** and is a **create-time** choice (locked once the Claw exists).

**Upload the `software-qa-mcp` example:**

1. Fill in name, provider, and credentials as above.
2. **Config owner** → **User**.
3. **OpenClaw workspace source** → **Upload a folder**, and pick
   `claw-collections/software-qa-mcp` from your local clone (uploads cap at
   1 MiB).
4. Click **Create**.

> Prefer Git? Choose **Git repository** instead:
> URL `https://github.com/redhat-et/claw-collections.git`, ref `main` (branch or
> tag — not a SHA), path `software-qa-mcp`.

## Add your own claw-collection

Build your own bundle as a directory tree, then seed a new **User**-managed Claw
from it (Upload, or your own Git repo). Layout in short:

- `workspace-main/` → `~/.openclaw/workspace/` (`AGENTS.md`, `SOUL.md`, `skills/`, …)
- `openclaw.json` → merged into the Claw's config (agents, MCP servers, cron)
- any other top-level folder → copied under `~/.openclaw/`

See `../claw-collections` (its README has the full layout) and the
`software-qa-mcp/` example for working wiring.

