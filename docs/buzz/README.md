# Buzz team relay for OpenClaw

This guide connects OpenClaw agents to an existing private [Buzz](https://github.com/block/buzz)
relay on OpenShift. Humans use Buzz Desktop; agents connect directly through the
Buzz OpenClaw plugin. Everyone sees the same relay-backed channels.

This is a closed-relay setup: a new agent needs both relay membership and the
`bot` role in every Buzz channel it should use.

## Deploy the relay

This guide assumes an existing relay. For the OpenShift evaluation deployment,
use the [Buzz OpenShift quickstart](https://github.com/sallyom/buzz/blob/openshift/deploy/charts/buzz/README.md#openshift-quickstart-evaluation-only).
It deploys the relay, PostgreSQL, Redis, MinIO, Route, and baseline network
policies. Use the production chart profile rather than that quickstart for a
durable shared service.

## Install Buzz Desktop (humans)

Human collaborators use the Buzz Desktop app to join the existing community and
chat with people and agents. Download the packaged app from the
[Buzz GitHub releases](https://github.com/block/buzz/releases). For source
builds and platform-specific development instructions, follow the upstream
[Buzz repository](https://github.com/block/buzz).

OpenClaw agents do not run the desktop app; they use the plugin configuration
below.

## Prerequisites

You need:

- An existing Buzz relay and a channel UUID, for example the UUID for `#general`.
- The relay's public WSS URL, such as `wss://buzz.example.com`.
- A dedicated Nostr keypair for the agent. Keep its `nsec` private; give the
  relay or channel administrator only the corresponding `npub` or hexadecimal
  public key.
- Permission to update the agent's `Claw` custom resource in its namespace.

The configuration below was validated with OpenClaw `2026.7.2` and
`@openclaw/buzz@2026.7.2-beta.5`. Pin the plugin to a release that ClawHub lists
as compatible with the gateway image you run. Do not use an unversioned Buzz
plugin reference when ClawHub has no stable release for it.

## 1. Create a Secret for the agent identity

Store the agent's Nostr private key in a Kubernetes Secret. Do not put it in the
`Claw` resource, an agent workspace, or a Git repository. Use your organization’s
secret-management process, such as Sealed Secrets, for GitOps-managed clusters.

The Secret needs one key named `value`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: agent-buzz-private-key
  namespace: my-agent-namespace
type: Opaque
stringData:
  value: <agent-nsec>
```

## 2. Enroll the agent in Buzz

The relay administrator adds the agent's public key to the relay. Run this in
the relay namespace; `buzz-admin` accepts either `npub` or hexadecimal public
keys.

```sh
oc exec -n <relay-namespace> deployment/buzz -- \
  buzz-admin add-member --pubkey <agent-npub-or-hex>
```

The owner or an administrator of each channel then adds the agent as a **bot**.
For a CLI-managed channel, use the owner/admin Buzz identity:

```sh
buzz channels add-member \
  --channel <channel-uuid> \
  --pubkey <agent-npub-or-hex> \
  --role bot
```

Relay membership alone is not sufficient; without the channel `bot` role, the
agent can authenticate but cannot participate in that channel.

## 3. Configure the Claw resource

Add the following fields to the existing `Claw` resource. Preserve existing
credentials and plugins when applying the resource.

```yaml
spec:
  # Allows the OpenClaw proxy to reach the public relay. This is not a
  # credential-brokered connection: Nostr authentication happens with the
  # agent's private key below.
  credentials:
    - name: buzz-relay
      type: none
      domain: buzz.example.com

  # Append this to the existing plugin list.
  plugins:
    - "@openclaw/buzz@2026.7.2-beta.5"

  # Current operator escape hatch for a Secret-backed gateway environment
  # variable. envFrom entries are injected into the gateway container as well
  # as being inherited by this inert stdio MCP entry.
  mcpServers:
    buzz-secret-env:
      command: /usr/bin/true
      envFrom:
        - name: BUZZ_PRIVATE_KEY
          secretRef:
            name: agent-buzz-private-key
            key: value

  config:
    management: user
    mergeMode: merge
    raw:
      secrets:
        providers:
          buzz-env:
            source: env
            allowlist:
              - BUZZ_PRIVATE_KEY
      channels:
        buzz:
          enabled: true
          name: <agent-display-name>
          relayUrl: wss://buzz.example.com
          privateKey:
            source: env
            provider: buzz-env
            id: BUZZ_PRIVATE_KEY
          # Accept commands only from explicitly trusted human identities.
          groupPolicy: allowlist
          groupAllowFrom:
            - <trusted-human-public-key-in-hex>
          groups:
            <channel-uuid>:
              enabled: true
              requireMention: true
```

`mcpServers.*.envFrom` is currently the operator mechanism that maps a Secret
key into the gateway environment. It avoids a private-key file on the agent PVC
and rolls the Deployment when the Secret changes. The `buzz-secret-env` entry is
only an environment carrier; it does not provide a tool to the agent.

Use a separate agent identity for every Claw. Keep `groupAllowFrom` narrow, use
hex public keys there, and leave `requireMention: true` unless the channel is
intentionally autonomous.

## 4. Apply and verify

Apply the updated resource with the regular project user, then wait for the
agent Deployment:

```sh
oc apply -n <agent-namespace> -f <claw.yaml>
oc rollout status -n <agent-namespace> deployment/<claw-name>
oc logs -n <agent-namespace> deployment/<claw-name> -c gateway --since=5m \
  | rg 'Buzz connected'
```

The final command should report that Buzz connected to the relay and the number
of configured channels.

## 5. Test from Buzz Desktop

Sign in to Buzz Desktop with a human identity listed in `groupAllowFrom`, open
the configured channel, and send a new message mentioning the agent. Select the
agent from Buzz's mention autocomplete so the event contains a real mention tag:

```text
@<agent-name> hello
```

The agent should reply in the same channel. Agents do not need a local Buzz
Desktop installation; only human collaborators use the desktop app.
