# Sharing memory across Claws with MemoryHub

This guide shows how to give a fleet of Claw instances a shared, persistent, semantically searchable memory using [MemoryHub](https://github.com/redhat-ai-americas/memory-hub), connected to each Claw as an MCP server. Every manifest and command here was verified against the octo-claws cluster with MemoryHub cluster edition and claw-operator, using two pilot Claws that read and write each other's memories.

A Claw is stateless. Restart it and everything it learned is gone, and nothing it learned was ever visible to any other Claw. MemoryHub gives the fleet an external memory that any agent can write to and any other agent can search, so a fact one agent discovers becomes fleet knowledge instead of dying with the pod.

## Architecture

```
Claw gateway pod (your namespace)
    | MCP over streamable-http (8080)
    v
memory-hub-mcp (namespace: memory-hub-mcp)
    |-- embedding service (TEI, CPU)      vectorize on write
    |-- reranker service (TEI, CPU)       reorder candidates on read
    |-- PostgreSQL + pgvector             system of record
    |-- MinIO                             large payloads
    +-- Valkey                            cache
```

Key facts that shape the setup:

- Agents authenticate with an **API key presented at the application layer**, by calling MemoryHub's `register_session` tool. This is not HTTP transport auth, which is what makes credential handling awkward. See [Credential handling](#credential-handling).
- Memories are **scoped**, and scope is the only thing that makes memory shared. Two agents see each other's writes because they use the same scope and project, not because of anything in the network wiring.
- Search and list default to `owner_id` = the calling agent. An agent that does not override this sees an empty result set and will report that sharing is broken when it is working correctly.
- Reaching an in-cluster MCP server from a Claw requires **both** a NetworkPolicy egress rule and a decision about the credential proxy. Getting only one of the two produces a failure that looks like a network problem but is not.
- The MCP endpoint path is `/mcp/`. The trailing slash is required; `/mcp` does not route.

## Prerequisites

- A namespace with Claw instances managed by claw-operator, and permission to edit Claw resources in it.
- MemoryHub deployed on the cluster (see [Deploying MemoryHub](#deploying-memoryhub) below), or an existing instance you can register an identity with.
- `openssl` on the machine running the MemoryHub installer. The install generates auth material and fails without it.

Throughout this guide `$NS` is your Claw namespace.

```sh
export NS=<your-claw-namespace>
```

## Deploying MemoryHub

Skip this section if MemoryHub is already running on your cluster.

MemoryHub cluster edition installs with `make install` from the upstream repository. It creates six namespaces:

| Namespace | Workload | Role |
| --------- | -------- | ---- |
| `memory-hub-mcp` | `memory-hub-mcp` | MCP server, the only agent-facing component |
| | `memoryhub-minio` | Blob store for large payloads |
| | `memoryhub-valkey` | Cache |
| | `memoryhub-retention-sweep` | CronJob, prunes expired memories |
| `memoryhub-db` | `memoryhub-pg-0` | PostgreSQL with pgvector, the system of record |
| `memoryhub-auth` | `auth-server` | API key validation and JWKS issuer |
| `memoryhub-ui` | `memoryhub-ui` | Dashboard |
| `embedding-model` | `all-minilm-l6-v2` | Text embeddings inference, CPU |
| `reranker-model` | `ms-marco-minilm-l12-v2` | Reranking, CPU |

The MCP server, auth server, and UI are built in-cluster from BuildConfigs of type Docker with a Binary source, meaning the installer streams your local working tree up and builds there. The images cannot be rebuilt without that source tree, so keep the checkout you installed from.

Both model servers run on CPU. No GPU is required.

### Required fix: enable truncation on the embedding service

As shipped, any memory write longer than roughly 1.5KB fails with `413 ContentTooLarge`. The embedding model has a 512-token window and the inference server rejects oversized input instead of truncating it, which limits the service to one-line memories.

Add `--auto-truncate` to the embedding deployment:

```sh
oc patch deployment all-minilm-l6-v2 -n embedding-model --type=json \
  -p '[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--auto-truncate"}]'
```

Verify:

```sh
oc get deployment all-minilm-l6-v2 -n embedding-model \
  -o jsonpath='{.spec.template.spec.containers[0].args}'
```

Expected to include `--auto-truncate` alongside `--model-id` and `--port`.

> **Note:** the embedding and reranker deployments use ReadWriteOnce PVCs for their model caches. A rolling update deadlocks, because the new pod cannot attach the volume until the old pod releases it and the old pod will not terminate until the new one is ready. Delete the old pod by hand to complete any rollout of these two deployments.

## Step 1: register an agent identity

Each Claw needs its own MemoryHub identity and API key. Identities live in a `users.json` document delivered as a ConfigMap.

Each user entry carries a `user_id`, an `api_key`, a `tenant_id`, and a list of allowed `scopes`. Available scopes are `user`, `project`, `role`, `organizational`, `enterprise`, and `campaign`. Give each agent the narrowest set it needs; `user` and `project` is enough for fleet sharing.

```json
{
  "user_id": "agent-1",
  "name": "Pilot A",
  "api_key": "<generated key>",
  "tenant_id": "default",
  "scopes": ["user", "project"],
  "project_memberships": []
}
```

> **Warning:** add new identities to `memory-hub-mcp/deploy/users-configmap.yaml` in the repository, not by editing the live ConfigMap. `make deploy-mcp` re-applies that file and silently destroys any identity added only to the cluster, which takes every affected agent offline. Restart the MCP pod after changing users, since the file is read at startup and not watched.

Leave `project_memberships` empty. Membership is granted automatically on an agent's first **write** to a project. Searching alone does not enroll an agent, so a read-only agent never joins the project and sees nothing.

## Step 2: connect the Claw

Three additions to the Claw resource.

### 2a. Declare the MCP server

```yaml
spec:
  mcpServers:
    memoryhub:
      transport: streamable-http
      url: http://memory-hub-mcp.memory-hub-mcp.svc:8080/mcp/
```

### 2b. Allow egress

```yaml
spec:
  network:
    inClusterBypass: true
    additionalEgress:
      - ports:
          - port: 8080
            protocol: TCP
        to:
          - namespaceSelector:
              matchLabels:
                kubernetes.io/metadata.name: memory-hub-mcp
```

Both fields are needed, and they do different jobs.

`additionalEgress` appends a rule to the gateway pod's NetworkPolicy so the traffic is permitted at all.

`inClusterBypass: true` adds `.svc` and `.svc.cluster.local` to the gateway's `NO_PROXY`, letting it reach the MCP server directly instead of through the credential proxy. With the `.svc` URL above, this is required: without it the request is sent to the proxy, which has no route for that domain, and the call fails in a way that looks like a network policy problem. The alternative, which keeps the proxy in the path and is the better option if you want the key in a Secret, is described next.

### 2c. Give the agent its identity and usage protocol

The agent needs to know its key and what it is expected to do with the memory tool. Both are delivered as workspace files, which the operator recreates on every pod start.

```yaml
spec:
  workspace:
    files:
      AGENTS.md: |
        # Agent instructions

        Read MEMORYHUB.md in this workspace and follow it. It is mandatory:
        register with MemoryHub at session start, search shared memory before
        answering questions about fleet knowledge, and write durable facts
        back at project scope.
      MEMORYHUB.md: |
        # MemoryHub: shared fleet memory (REQUIRED)

        You are connected to MemoryHub, a shared memory service used by every
        claw in this fleet. Your identity is `agent-1`.

        ## At the start of every session

        1. Call the `register_session` tool on the `memoryhub` MCP server with:
           api_key: <this agent's key>
        2. Then call the `memory` tool with action "search" for the topic you
           are working on before assuming you lack context. Other claws may
           already have stored what you need. IMPORTANT: always include
           options {"owner_id": ""} in search and list calls; without it the
           server only returns your own memories, not the fleet's.

        ## During the session

        - Store durable facts other claws should know (decisions, findings,
          configuration knowledge, user preferences) with the `memory` tool,
          action "write", scope "project", project "claw-fleet".
        - Search MemoryHub whenever the topic changes or you hit an unknown
          term. Use action "search" with a focused query.
        - Do not store secrets, tokens, or ephemeral chatter.
        - Prefer updating an existing memory over writing a duplicate.
```

`AGENTS.md` is not optional decoration. A workspace file the agent never reads changes nothing, and `AGENTS.md` is what makes the protocol mandatory rather than merely available.

Every Claw in the fleet must use the same `project` value. An agent pointed at a different project is isolated even though everything else is configured correctly.

## Credential handling

MemoryHub authenticates agents by an API key passed as an argument to the `register_session` tool, not by an HTTP header. That has a direct consequence: **in the configuration above, the key is plaintext in the Claw resource**, the operator writes it into the workspace, and the agent reads it as text. Anyone who can read Claw resources in the namespace can read the key.

This is acceptable for a pilot and should not ship. Two better options exist, with different tradeoffs.

### What does not work

`envFrom` with a `secretRef` on the MCP server entry is rejected by the operator's validating webhook:

```text
spec.mcpServers[memoryhub]: Invalid value: "object": envFrom is only allowed
for stdio MCP servers (command), not HTTP (url)
```

`credentialRef` on the MCP server entry is proxy-mediated, so it is incompatible with a `.svc` URL while `inClusterBypass` is true. The operator detects this combination and warns that "in-cluster traffic bypasses the proxy, so credentials cannot be injected".

### What does work: route in-cluster traffic back through the proxy

`inClusterBypass` only adds `.svc` and `.svc.cluster.local` to `NO_PROXY`. A Kubernetes Service also resolves at the two-label form `<service>.<namespace>`, which does **not** match those suffixes and therefore still traverses the credential proxy. That is enough to get real credential injection into an in-cluster call while keeping `inClusterBypass` enabled for everything else.

Declare a credential with a `domain` and no `provider`:

```yaml
spec:
  credentials:
    - name: memoryhub
      domain: memory-hub-mcp.memory-hub-mcp
      type: bearer
      secretRef:
        - key: api-key
          name: memoryhub-agent-key
```

Omitting `provider` matters. With `provider` set, the operator generates and owns the corresponding config entry and rewrites its `baseUrl` to `https://<domain>` with no port and no path on every pod restart, which is wrong for a plain-HTTP service on a non-443 port. A domain-only credential still produces the proxy route while leaving the entry unmanaged.

Then address the MCP server without the `.svc` suffix:

```yaml
spec:
  mcpServers:
    memoryhub:
      transport: streamable-http
      url: http://memory-hub-mcp.memory-hub-mcp:8080/mcp/
```

The proxy overwrites the `Authorization` header entirely, so the agent never holds the real key. Note that the proxy's own NetworkPolicy allows only TCP 443, and `additionalEgress` extends the gateway pod's policy rather than the proxy's, so this path needs a separate NetworkPolicy granting the proxy egress to the MemoryHub pod and port. Policies are additive, so a separately named one is not reverted by the operator.

This pattern is verified in production use for an in-cluster model endpoint. Applying it to MemoryHub specifically also requires MemoryHub to accept a bearer `Authorization` header in place of the `register_session` key argument. Confirm that against your MemoryHub version before relying on it.

## Step 3: verify

The cheapest end to end proof is a codeword test, which exercises identity, egress, scope, embedding on write, and retrieval with reranking in a single pass:

1. Give the first Claw a distinctive term in conversation and tell it to store the term at project scope.
2. In a separate session with no shared context, ask a second Claw about the term.
3. The second Claw retrieves it from MemoryHub.

Re-run this after any change to the users ConfigMap, the network configuration, or the MCP deployment.

Check that the backing services are healthy:

```sh
for ns in memory-hub-mcp memoryhub-db memoryhub-auth memoryhub-ui embedding-model reranker-model; do
  echo "== $ns"; oc get pods -n $ns
done
```

## Troubleshooting

**An agent sees only its own memories.** It is omitting `options: {"owner_id": ""}` on `search` and `list`. This is the single most common cause of "sharing does not work" and it is a client-side omission, not a server problem.

**An agent sees nothing at all in a project other agents are using.** It has never written to that project. Membership is granted on first write, so have it store something once.

**Writes over roughly 1.5KB fail with 413.** `--auto-truncate` is missing from the embedding deployment. See [Required fix](#required-fix-enable-truncation-on-the-embedding-service).

**Connection failures that look like NetworkPolicy problems.** Check whether the URL matches `NO_PROXY`. A `.svc` URL without `inClusterBypass: true` goes to the proxy, which has no route for it. A non-`.svc` URL with a credential goes through the proxy by design and needs the proxy's own egress opened.

**User changes have no effect.** The MCP server reads `users.json` at startup. Restart the pod.

**A rollout of the embedding or reranker deployment hangs.** ReadWriteOnce PVC. Delete the old pod.

## Security considerations

- In the workspace-file configuration, **agent API keys are plaintext in the Claw resource** and readable by anyone with read access to Claw resources in the namespace. Prefer the proxy-injected pattern above for anything beyond a pilot.
- Upstream stores identities and their keys in a **ConfigMap**, not a Secret. Anything with read access to the MemoryHub namespace can read every agent's key.
- The MCP route is externally reachable by default. If you do not need external access, remove the route and rely on the in-cluster Service.
- MemoryHub runs a PII scanner over writes. Verify its behavior against your own data before trusting it: the `phone_us` pattern in `curation/scanner.py` matches bare ten-digit numbers, so identifiers such as issue or comment IDs can be misclassified and block legitimate writes.
- Instruct agents not to store secrets. The usage protocol above includes that line, and it is worth keeping.
