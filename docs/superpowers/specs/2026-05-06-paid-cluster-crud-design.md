# Paid Cluster CRUD Tools — Design

**Date:** 2026-05-06
**Branch:** `approach-a` (forked from `apix-offsite-hackathon`)
**Status:** Design approved; implementation pending

## Goal

Add three new MCP tools that let an LLM agent create, read, and update **paid (dedicated/flex) Atlas clusters** with full configurability — close to the underlying Atlas Admin API, no opinionated presets. Targeted at the [case_8_mcp_tool_strategy](https://github.com/mongodb-labs/mdb-atlas-devops-llm-evals/tree/main/cases/case_8_mcp_tool_strategy) eval, specifically the `full_crud_only` tool-set strategy.

The eval scenarios this design must support:

1. **Dev cluster** — single-region M10/M20 REPLICASET, AWS, autoscale compute+disk.
2. **Budget production cluster** — single-region M30+ REPLICASET, AWS US_EAST_1, autoscale, backup on, **paused after create**.
3. **HA production cluster** — REPLICASET across **3+ AWS regions**, ≥5 electable nodes, M30+, autoscale, backup on, US_EAST_1 included, **paused after create**.

Existing tools (`atlas-create-free-cluster`, `atlas-list-clusters`, `atlas-inspect-cluster`) stay untouched. New tools are additive.

## Non-goals

- No `delete` / `pause` / `resume` tool. Pause = `atlas-update-cluster` with `paused: true`. Delete is out of scope (existing `atlas-delete-cluster` is not affected).
- No preset/convenience wrappers (e.g. `create_dev_cluster`). The point is API-shaped flexibility.
- No automated tests (hackathon scope). Manual testing plan only.

## Architecture

```
atlas-create-cluster   ──(POST  /groups/{groupId}/clusters)──► createCluster
atlas-get-cluster      ──(GET   /groups/{groupId}/clusters/{name})──► getCluster
atlas-update-cluster   ──(PATCH /groups/{groupId}/clusters/{name})──► updateCluster (NEW)
                                         ▲
                                         │
                       shared clusterConfigSchema (Zod)
                       mirrors ClusterDescription20240805
                       every field .describe()'d
```

**One shared Zod schema** is defined once and reused across create input, update input, and read output. Field names and nesting **exactly match** `ClusterDescription20240805` so a `get` → mutate → `update` round-trip is mechanical with no reshaping.

A new thin `apiClient.updateCluster` wrapper is added to `src/common/atlas/apiClient.ts`, modeled after the existing `createCluster` wrapper.

## Components

### Shared schema — `src/tools/atlas/shared/clusterConfig.ts` (NEW)

Curated Zod object mirroring `ClusterDescription20240805`. Every field carries a `.describe()` rich enough that the LLM can shape a correct body without reading API docs separately. Critical fields get multi-sentence descriptions explaining required combinations:

- `electableSpecs.instanceSize` / `nodeCount` / `priority` — when required, `priority: 7` for primary region.
- `autoScaling.compute.enabled` + `maxInstanceSize` — required pairing.
- `autoScaling.diskGB.enabled` — when used.
- `replicationSpecs[]` — "one entry per shard; for REPLICASET use exactly one entry; each entry's `regionConfigs[]` holds per-region node configs and is the lever for multi-region HA."
- `backupEnabled`, `pitEnabled` — relationship (PIT requires backup).
- `paused` — "set to true to pause; cluster must be IDLE first."
- `terminationProtectionEnabled`.
- `tags[]`.

The schema accepts the shape `ClusterDescription20240805` accepts. Cast at the API boundary (`as unknown as ClusterDescription20240805`) when invoking the client, matching the existing pattern in `createFreeCluster.ts`.

### Tool 1 — `atlas-create-cluster`

- **File:** `src/tools/atlas/create/createCluster.ts`
- **Category:** `atlas`
- **Operation type:** `create`
- **Args:** `projectId`, plus `clusterConfigSchema` flattened at top level (LLM sees `name`, `clusterType`, `replicationSpecs`, etc. as named tool args, not nested under `body`).
- **Description:** _"Create a paid (dedicated/flex) MongoDB Atlas cluster with full control over topology, regions, instance size, autoscaling, and backup. For a free M0 cluster, prefer `atlas-create-free-cluster`."_
- **Behavior:** call `ensureCurrentIpInAccessList(this.apiClient, projectId)` (parity with the free tool), then `apiClient.createCluster({ params: { path: { groupId: projectId } }, body: <schema-shaped> })`.
- **Returns:** short text confirmation including cluster name and current state.

### Tool 2 — `atlas-get-cluster`

- **File:** `src/tools/atlas/read/getCluster.ts`
- **Category:** `atlas`
- **Operation type:** `read`
- **Args:** `projectId`, `clusterName`.
- **Description:** _"Get the full configuration of a cluster, in the exact shape accepted by `atlas-update-cluster`. Call this before any update."_
- **Behavior:** call `apiClient.getCluster`. Strip read-only fields from the returned config so the round-trip JSON is directly usable as an update body. Stripped fields: `id`, `groupId`, `stateName`, `mongoDBVersion`, `createDate`, `connectionStrings`, `versionReleaseSystem`, `featureCompatibilityVersion`, `acceptDataRisksAndForceReplicaSetReconfig`, `replicationSpecs[].id`, `replicationSpecs[].zoneId`. These read-only fields are reported in the text portion of the response so the agent still has visibility into current state.
- **Coexists** with `atlas-inspect-cluster` (existing tool keeps its summary role).

### Tool 3 — `atlas-update-cluster`

- **File:** `src/tools/atlas/update/updateCluster.ts` (new directory)
- **Category:** `atlas`
- **Operation type:** `update`
- **Args:** `projectId`, `clusterName`, plus `clusterConfigSchema` flattened (same shape as create).
- **Description (must mention all of the below):**
  > _"Update an existing cluster. **Workflow: always call `atlas-get-cluster` first, modify the returned config, then pass the full modified config here.** This avoids accidentally clearing arrays like `replicationSpecs` or `tags` (the API replaces these wholesale). To pause, set `paused: true` (cluster must be IDLE first); to resume, set `paused: false`. If the cluster is not IDLE the API will reject the change — wait and retry."_
- **API client wrapper:** add `apiClient.updateCluster(options: FetchOptions<operations["updateGroupCluster"]>)` next to `createCluster` in `src/common/atlas/apiClient.ts`, modeled after the existing `createCluster` shape (typed by `ClusterDescription20240805`).
- **Returns:** short text confirmation + new state.

### Tool registration

Re-export the three new classes from `src/tools/atlas/tools.ts`:

```ts
export { CreateClusterTool } from "./create/createCluster.js";
export { GetClusterTool } from "./read/getCluster.js";
export { UpdateClusterTool } from "./update/updateCluster.js";
```

`AllTools` in `src/tools/index.ts` aggregates these automatically. `confirmationRequiredTools` does not need updating — `update` and `create` are not destructive in the elicitation sense.

## File layout

```
src/tools/atlas/
├── create/
│   ├── createCluster.ts          # NEW
│   └── createFreeCluster.ts      # unchanged
├── read/
│   ├── getCluster.ts             # NEW
│   ├── inspectCluster.ts         # unchanged
│   └── ...
├── update/                       # NEW DIRECTORY
│   └── updateCluster.ts          # NEW
├── shared/                       # NEW DIRECTORY
│   └── clusterConfig.ts          # NEW — shared Zod schema
└── tools.ts                      # add 3 re-exports

src/common/atlas/
└── apiClient.ts                  # add updateCluster() wrapper
```

## Data flow

### Canonical update flow

```
1. agent: atlas-get-cluster { projectId, clusterName }
       └► returns full ClusterDescription, stripped of read-only fields
                                                     │
2. agent: mutates fields (e.g. paused: true, or adds a regionConfig)
                                                     │
3. agent: atlas-update-cluster { projectId, clusterName, ...modifiedConfig }
       └► PATCH; returns updated cluster summary
```

### Case-mapped flows

**Dev cluster (case_8 ex 1/2):** single tool call.

```
atlas-create-cluster {
  projectId, name: "dev", clusterType: "REPLICASET",
  replicationSpecs: [{
    regionConfigs: [{
      providerName: "AWS", regionName: "US_EAST_1", priority: 7,
      electableSpecs: { instanceSize: "M10", nodeCount: 3 },
      autoScaling: { compute: { enabled: true, maxInstanceSize: "M30" }, diskGB: { enabled: true } }
    }]
  }]
}
```

**Budget prod (case_8 ex 3):** create → get (after IDLE) → update with `paused: true`. Full round-trip exercise.

**HA prod (case_8 ex 4):** single create with `replicationSpecs[0].regionConfigs` containing 3 entries (`US_EAST_1` priority 7, `US_WEST_2` priority 6, `US_EAST_2` priority 5), electable nodes summing to ≥5, autoscale + backup enabled. Then update with `paused: true`.

## Error handling

- **Auth errors (401/402/403)** — handled by `AtlasToolBase.handleError`. Inherited.
- **404 on `atlas-get-cluster` / `atlas-update-cluster`** — catch `ApiClientError` with `status === 404` in each tool, return _"Cluster `{name}` not found in project `{projectId}`. Use `atlas-list-clusters` to see what exists."_ No base-class change.
- **400 from create/update** (validation errors from Atlas) — surface the API's `error.message` via the default error path. No special-casing.
- **409 on pause when cluster not IDLE** — surfaced via default `ApiClientError` path. The update tool's description warns the agent up front.
- **Zod validation failures** — handled by the MCP framework before `execute` runs; field `.describe()` text is what the LLM sees.

No new error types, no new util files.

## Testing plan (manual only)

### Prereqs

```bash
export MDB_MCP_API_CLIENT_ID="...cloud-dev service account..."
export MDB_MCP_API_CLIENT_SECRET="..."
export MDB_MCP_API_BASE_URL="https://cloud-dev.mongodb.com"
pnpm install && pnpm run build
```

A cloud-dev project ID is required (use existing project from Atlas UI or create via `mcp__mongodb__atlas-create-project`).

### Path A — MCP Inspector

```bash
pnpm run inspect
```

Steps:

| #   | Tool                   | Args                                                                                                                                                                     | Expected                                                                                           |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| A0  | `atlas-list-projects`  | —                                                                                                                                                                        | confirms auth works against cloud-dev                                                              |
| A1  | `atlas-create-cluster` | dev shape: M10, single AWS US_EAST_1, autoscale compute+disk on, `name: "smoke-dev"`                                                                                     | 2xx; cluster `CREATING` in Atlas UI                                                                |
| A2  | `atlas-get-cluster`    | `clusterName: "smoke-dev"`                                                                                                                                               | full body returned, no `id`/`stateName`/`mongoDBVersion` in round-trip JSON; state in text portion |
| A3  | `atlas-update-cluster` | A2's body with `terminationProtectionEnabled: true`                                                                                                                      | 2xx; subsequent get reflects the change                                                            |
| A4  | `atlas-update-cluster` | A2's body with `paused: true` (cluster must be IDLE first)                                                                                                               | 2xx; cluster shows PAUSED                                                                          |
| A5  | `atlas-create-cluster` | budget-prod shape: M30, single US_EAST_1, autoscale, `backupEnabled: true`, `name: "smoke-budget"`                                                                       | matches example_3 rubric                                                                           |
| A6  | `atlas-create-cluster` | HA shape: M30, 3 regionConfigs (US_EAST_1 priority 7, US_WEST_2 priority 6, US_EAST_2 priority 5), electable nodes summing to ≥5, autoscale + backup, `name: "smoke-ha"` | matches example_4 rubric                                                                           |
| A7  | `atlas-get-cluster`    | nonexistent name                                                                                                                                                         | clean 404 text result                                                                              |
| A8  | cleanup                | delete the three smoke clusters via Atlas UI or `atlas-delete-cluster`                                                                                                   | gone                                                                                               |

**Pass criteria:** every step completes; A2's JSON pasted into A3 succeeds without manual reshaping; A6 cluster shows 3 region configs in Atlas UI.

### Path B — Claude Code session against cloud-dev

Mirrors how case_8 evals run the agent — no schema cheat-sheet, just natural-language briefs.

MCP config:

```json
{
  "mcpServers": {
    "mongodb-mcp-paid-clusters": {
      "command": "node",
      "args": [
        "/Users/agustin.bettati/mongodb/mongodb-mcp-server/dist/esm/index.js"
      ],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "...",
        "MDB_MCP_API_CLIENT_SECRET": "...",
        "MDB_MCP_API_BASE_URL": "https://cloud-dev.mongodb.com"
      }
    }
  }
}
```

(Use the absolute `node` path if launching from a GUI client. Rebuild between code changes.)

Test prompts (one fresh session each, no leading hints):

| #   | Prompt                                                                                                                                                                                                                      | Mirrors                | Pass = cluster has                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| B1  | "Create the lowest-cost auto-scaling cluster you can in project `<id>` on AWS."                                                                                                                                             | case_8 ex 1/2          | M10 (or M20), single AWS region, autoscale compute+disk on                                                  |
| B2  | "I need a budget production cluster in project `<id>`. Razor-thin margins, M-F 9-5 only, weekend downtime fine, 150GB DB, ~50 conns peaking to 500 quarterly. AWS us-east-1. Create it and pause it."                       | case_8 ex 3            | M30+ REPLICASET, single US_EAST_1, autoscale + backup, paused after create                                  |
| B3  | "Create a multi-region HA production cluster in project `<id>`. AWS, must survive a full region outage, SRE mandates ≥3 regions with electable nodes. 1TB, ~1000 conns peaking 8000 in flash sales. Pause it once created." | case_8 ex 4            | M30+, 3+ AWS regions w/ electable nodes, ≥5 electable total, US_EAST_1 included, autoscale + backup, paused |
| B4  | "On the cluster `smoke-budget`, turn termination protection on."                                                                                                                                                            | round-trip read→update | tool call log shows `atlas-get-cluster` before `atlas-update-cluster`; update succeeds with no 4xx          |

### Qualitative observations to capture during Path B

- Did the agent call `atlas-get-cluster` before `atlas-update-cluster`? (If not, sharpen the description.)
- Did the create body have the right shape on first try? (If 2+ failed creates, sharpen `.describe()` text on the offending fields.)
- Did the agent know to pause via update, or hunt for a pause tool? (If hunting, surface the pause guidance more prominently in the update tool description.)

These three observations are the qualitative signal the hackathon wants — they tell us whether the typed-schema + rich-description approach actually pays off versus a raw-body alternative.

### Cleanup

```bash
pnpm run atlas:cleanup
```

## Open question parking lot

(None at design time. Will revisit during/after Path B if observations call for changes.)
