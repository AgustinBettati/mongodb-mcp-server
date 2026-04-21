# atlas-create-replica-set-cluster — Design

Date: 2026-04-21
Status: Approved

## Goal

Add a new MCP tool that creates a dedicated MongoDB Atlas replica set cluster (M10+) with a minimal, LLM-friendly schema. Sibling to the existing `atlas-create-free-cluster`.

## Scope

In scope:
- Single new tool class `CreateReplicaSetClusterTool` under `src/tools/atlas/create/`.
- Re-export from `src/tools/atlas/tools.ts` so it is picked up by `AllTools`.

Out of scope (left for follow-up tools):
- Provider choice (`AZURE`, `GCP`) — provider is hardcoded to `AWS`.
- Configurable node count — fixed at 3.
- Autoscaling (compute + disk).
- Backup / PIT / tags / `mongoDBMajorVersion` / termination protection.
- Sharded or geo-sharded topologies.
- Elicitation / confirmation flow (not destructive).
- Dedicated integration tests (manual verification via MCP Inspector against cloud-dev is sufficient for the hackathon).

## Tool specification

| Field | Value |
| --- | --- |
| `toolName` | `atlas-create-replica-set-cluster` |
| `category` | inherited from `AtlasToolBase` (`"atlas"`) |
| `operationType` | `"create"` |
| `description` | `"Create a dedicated MongoDB Atlas replica set cluster (M10+)."` |

### argsShape

| Arg | Validator | Default | Purpose |
| --- | --- | --- | --- |
| `projectId` | `AtlasArgs.projectId()` | — | Atlas project ID to create the cluster in |
| `name` | `AtlasArgs.clusterName()` | — | Cluster name |
| `region` | `AtlasArgs.region()` | `"US_EAST_1"` | AWS region |
| `instanceSize` | `z.enum(["M10","M20","M30","M40"])` | `"M10"` | Dedicated instance size |

Every field gets a `.describe(...)` call, matching the pattern in `createFreeCluster.ts`.

### Request body shape

Derived from `hackathon-examples/replica-set-request.json` with autoscaling removed:

```ts
{
  groupId: projectId,
  name,
  clusterType: "REPLICASET",
  replicationSpecs: [{
    zoneName: "Zone 1",
    regionConfigs: [{
      providerName: "AWS",
      regionName: region,
      priority: 7,
      electableSpecs: { instanceSize, nodeCount: 3 },
    }],
  }],
  terminationProtectionEnabled: false,
} as unknown as ClusterDescription20240805
```

### Execute flow

1. `await ensureCurrentIpInAccessList(this.apiClient, projectId)` — lets the caller connect afterwards.
2. `await this.apiClient.createCluster({ params: { path: { groupId: projectId } }, body })`.
3. Return a `CallToolResult` with text content summarizing name, instance size, and region, plus the standard access-list reminder.

Errors from `ApiClientError` are formatted by `AtlasToolBase.handleError` — no custom error handling needed.

### Telemetry

Rely on `AtlasToolBase.resolveTelemetryMetadata`, which already extracts `projectId`/`orgId`. No override needed.

## Registration

Add one line to `src/tools/atlas/tools.ts`:

```ts
export { CreateReplicaSetClusterTool } from "./create/createReplicaSetCluster.js";
```

`src/tools/index.ts` aggregates `AllTools` from these re-exports, so no other wiring is required.

## Verification

- `pnpm run build` succeeds.
- `pnpm run check` (lint / types / format / api-extractor) passes locally.
- Manual smoke test via `pnpm run inspect` against cloud-dev with the dev service-account credentials: call the tool with a test project, confirm the cluster is requested and visible in Atlas UI.
- **End-to-end verification through Claude:** configure the user's Claude MCP client to point at the locally built `dist/esm/index.js` with cloud-dev credentials and `MDB_MCP_API_BASE_URL=https://cloud-dev.mongodb.com`, restart the client, and drive the tool with a natural-language prompt (e.g. `"Create a replica set cluster named hackathon-rs in project <id>"`). Confirm the tool appears in the client, is invoked with the expected args, and the resulting cluster shows up in the cloud-dev Atlas UI.
