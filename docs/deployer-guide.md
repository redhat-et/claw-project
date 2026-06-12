# Using the OpenClaw Deployer

The **Deployer** is the OpenShift web app where you create or delete
your OpenClaws. Open its route URL, sign in with GitHub, and it
operates as *you* — you will only see your projects. Your namespace
defaults to `<your-login>-claw`. The deployer is designed to get you
up and running fast. Once running, you can interact with your OpenClaw
to configure everything else.

It's a thin client around the Claw API — see the
[claw-operator](https://github.com/redhat-et/claw-operator) to
learn more. Feel free to use the `Claw` Custom Resource directly
instead of or after deploying with this deployer.

You can view your Claw CRs with:

```bash
oc get claws -A
```

> [!NOTE]
> The Deployer defaults to setting `spec.config.management: user`.
> This gives direct access to your OpenClaw so you can modify it
> freely and natively through the OpenClaw Gateway and `openclaw` CLI.
> With `spec.config.management: operator`, claws are more locked down
> and reconciled, and to modify them you'd modify the CR instead of
> working with your agent directly.
> For exploration and development, use `management: user`.

## One-time setup: your Vertex service account

There is a dropdown of providers and most are simple "add your API
key" but Vertex is different. Create a service account and provide
its JSON key:

```bash
gcloud iam service-accounts create claw-vertex \
  --display-name="Claw Vertex AI"
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:claw-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=claw-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

You **paste the contents of `sa-key.json`** into the Deployer — it
creates the Kubernetes Secret for you.

> [!NOTE]
> Your OpenClaw agents do not have access to the secrets.
> The operator keeps provider keys in Secrets and injects them
> through a per-Claw proxy that sits between the gateway and
> external APIs, so the agent itself never sees your raw API key
> (and for Vertex, the proxy vends GCP tokens on its behalf).

## Create an OpenClaw named Fred on Vertex (Claude), no model override

1. **Namespace** — your project (e.g. `<your-login>-claw`).
1. **OpenClaw name** — `fred` (becomes `Fred` in the UI).
1. **Provider** — `Google Vertex AI (Claude)`.
1. **Model override** — leave **blank** (uses `claude-sonnet-4-6`).
1. **GCP Project ID** and **GCP region** (`global`).
1. **Service Account Key** — paste your `sa-key.json` contents.
1. Click **Create**. When Fred is Ready, use **Open Control UI** to
   open the UI and talk to it.

## Add a provider/model to a running Claw (OpenRouter + Nemotron)

Once a Claw exists, the **Create** button becomes
**Add/update provider**.

1. Select the same **Namespace** and **OpenClaw name** (`fred`).
1. **Provider** → `OpenRouter`.
1. **Model override** →
   `openrouter/nvidia/nemotron-3-ultra-550b-a55b`.
1. Paste your **OpenRouter API key**. See
   [openrouter.ai](https://openrouter.ai/).
1. Click **Add/update provider**. The new provider key Secret is
   added; Fred can now use that model alongside Vertex. You can
   switch between them. Ask Fred, it'll tell you how.

## Restart and delete

- **Restart Fred** — click **Restart** on Fred's row (or the top
  Restart button) and confirm.
- **Delete Fred** — click **Delete** and confirm. This removes the
  Claw, its provider Secret(s), and any uploaded workspace ConfigMap.
  **The project (namespace) stays.** If you no longer need it, clean
  it up yourself: `oc delete project <your-namespace>`.
