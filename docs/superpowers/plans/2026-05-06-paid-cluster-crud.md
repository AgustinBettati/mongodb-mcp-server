# Paid Cluster CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new MCP tools — `atlas-create-cluster`, `atlas-get-cluster`, `atlas-update-cluster` — that expose paid Atlas cluster CRUD with a typed Zod schema mirroring `ClusterDescription20240805`, every field richly described to help the LLM shape correct API bodies.

**Architecture:** One shared Zod schema (`clusterConfigSchema`) lives in `src/tools/atlas/shared/clusterConfig.ts` and is reused as create input, update input, and read output. A new `apiClient.updateCluster` wrapper handles `PATCH /groups/{groupId}/clusters/{clusterName}`. No automated tests — all verification is via MCP Inspector and a Claude Code session against cloud-dev.

**Tech Stack:** TypeScript, Zod, `openapi-fetch` (existing API client), MCP SDK, `pnpm` for tooling.

**Spec:** [docs/superpowers/specs/2026-05-06-paid-cluster-crud-design.md](../specs/2026-05-06-paid-cluster-crud-design.md)

---

## Task 1: Add `apiClient.updateCluster` wrapper

**Files:**

- Modify: `src/common/atlas/apiClient.ts` (insert after the existing `getCluster` at line 367)

- [ ] **Step 1: Insert the `updateCluster` method**

In `src/common/atlas/apiClient.ts`, immediately after the closing brace of the existing `getCluster` method (around line 367), add:

```ts
    async updateCluster(
        groupId: string,
        clusterName: string,
        body: components["schemas"]["ClusterDescription20240805"]
    ): Promise<components["schemas"]["ClusterDescription20240805"]> {
        // openapi.d.ts (pinned to 2025-03-12) currently does not type PATCH for this
        // path (`patch?: never`), but the Atlas API supports it: operation
        // `updateCluster`, schema version 2024-08-05. The body shape is the same
        // ClusterDescription20240805 used by createCluster.
        const { data, error, response } = await this.client.PATCH(
            "/api/atlas/v2/groups/{groupId}/clusters/{clusterName}" as never,
            {
                params: { path: { groupId, clusterName } },
                body,
            } as never
        );
        if (error) {
            throw ApiClientError.fromError(response, error as never);
        }
        return data as components["schemas"]["ClusterDescription20240805"];
    }
```

- [ ] **Step 2: Type-check by building**

```bash
pnpm run build
```

Expected: build succeeds, no TypeScript errors. If TS complains about `client.PATCH` not existing on the path, double-check the two `as never` casts are present (one on the path string, one on the options object).

- [ ] **Step 3: Commit**

```bash
git add src/common/atlas/apiClient.ts
git commit -m "feat(api-client): add updateCluster PATCH wrapper"
```

---

## Task 2: Create the shared cluster config Zod schema

**Files:**

- Create: `src/tools/atlas/shared/clusterConfig.ts`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p src/tools/atlas/shared
```

Create `src/tools/atlas/shared/clusterConfig.ts` with the following contents:

```ts
import { z } from "zod";

const electableSpecsSchema = z.object({
  instanceSize: z
    .enum([
      "M0",
      "M2",
      "M5",
      "M10",
      "M20",
      "M30",
      "M40",
      "M50",
      "M60",
      "M80",
      "M140",
      "M200",
      "M300",
      "M400",
      "M700",
    ])
    .describe(
      "Atlas instance tier. M0/M2/M5 are TENANT (free/flex; backingProviderName required). " +
        "M10+ are dedicated and require nodeCount. For production workloads use M30 or higher."
    ),
  nodeCount: z
    .number()
    .int()
    .min(0)
    .max(50)
    .optional()
    .describe(
      "Number of electable (voting) nodes in this region config. " +
        "Required for M10+ (typically 3 for replica sets, more for HA across regions). " +
        "Omit for TENANT (M0/M2/M5)."
    ),
  diskSizeGB: z
    .number()
    .optional()
    .describe(
      "Storage size in GB. Optional; when autoScaling.diskGB.enabled is true, Atlas resizes this automatically."
    ),
  diskIOPS: z
    .number()
    .int()
    .optional()
    .describe(
      "Provisioned IOPS for AWS provisioned storage. Leave unset to use defaults."
    ),
  ebsVolumeType: z.enum(["STANDARD", "PROVISIONED"]).optional(),
});

const computeAutoScalingSchema = z.object({
  enabled: z
    .boolean()
    .describe(
      "Master toggle for compute (instance size) autoscaling within this region config."
    ),
  scaleDownEnabled: z
    .boolean()
    .optional()
    .describe("Allow autoscale-down. When true, minInstanceSize is required."),
  minInstanceSize: z
    .string()
    .optional()
    .describe(
      "Lower bound (e.g. 'M10'). Required when scaleDownEnabled is true."
    ),
  maxInstanceSize: z
    .string()
    .optional()
    .describe("Upper bound (e.g. 'M40'). Required when enabled is true."),
});

const diskAutoScalingSchema = z.object({
  enabled: z
    .boolean()
    .describe(
      "Master toggle for storage autoscaling. Strongly recommended for any production cluster."
    ),
});

const autoScalingSchema = z
  .object({
    compute: computeAutoScalingSchema.optional(),
    diskGB: diskAutoScalingSchema.optional(),
  })
  .describe(
    "Per-region-config autoscaling. Important: autoScaling lives on each regionConfigs[] entry, NOT on the top-level cluster. " +
      "When compute.enabled is true, maxInstanceSize is required. When scaleDownEnabled is true, minInstanceSize is also required."
  );

const regionConfigSchema = z.object({
  providerName: z
    .enum(["AWS", "AZURE", "GCP", "TENANT"])
    .describe(
      "Cloud provider for this region config. Use TENANT for free (M0) and flex (M2/M5) tiers — backingProviderName is then required."
    ),
  backingProviderName: z
    .enum(["AWS", "AZURE", "GCP"])
    .optional()
    .describe(
      "Required when providerName is TENANT — the underlying provider for the free/flex tier."
    ),
  regionName: z
    .string()
    .describe(
      "Cloud region (e.g. 'US_EAST_1', 'EU_WEST_1'). Use the provider's Atlas-region naming (uppercase with underscores for AWS)."
    ),
  priority: z
    .number()
    .int()
    .min(0)
    .max(7)
    .optional()
    .describe(
      "Election priority. Set to 7 to mark the primary region (required for any M10+ dedicated tier). " +
        "For multi-region HA assign priority 7 to the primary region and decreasing values (6, 5, ...) to secondaries."
    ),
  electableSpecs: electableSpecsSchema
    .optional()
    .describe(
      "Electable (voting) nodes in this region. Required for any region that should participate in primary election. " +
        "For 3+ region HA, distribute electable nodes so quorum survives the loss of the primary region (e.g. 3 + 2 + 2)."
    ),
  readOnlySpecs: electableSpecsSchema
    .partial()
    .optional()
    .describe(
      "Read-only (non-voting) nodes for additional read capacity. Avoid for budget tiers."
    ),
  analyticsSpecs: electableSpecsSchema
    .partial()
    .optional()
    .describe(
      "Analytics (non-voting, isolated) nodes for analytics workloads. Avoid for budget tiers."
    ),
  autoScaling: autoScalingSchema.optional(),
});

const replicationSpecSchema = z.object({
  zoneName: z
    .string()
    .optional()
    .describe(
      "Zone name. For REPLICASET use 'Zone 1' (default). For GEOSHARDED use distinct zone names per shard set."
    ),
  regionConfigs: z
    .array(regionConfigSchema)
    .min(1)
    .describe(
      "Per-region node configurations within this shard. For multi-region HA list 3+ region configs each with electable nodes."
    ),
});

const tagSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const clusterConfigSchemaRaw = {
  name: z
    .string()
    .min(1)
    .max(64)
    .describe("Cluster name. Immutable after creation."),
  clusterType: z
    .enum(["REPLICASET", "SHARDED", "GEOSHARDED"])
    .describe(
      "Topology. REPLICASET = single replica set; SHARDED = sharded cluster (one replicationSpecs entry per shard, " +
        "no numShards field — this API uses Independent Shard Scaling); GEOSHARDED = geographically distributed shards."
    ),
  mongoDBMajorVersion: z
    .string()
    .optional()
    .describe(
      "MongoDB major version (e.g. '7.0'). Optional; Atlas picks a default if unset."
    ),
  backupEnabled: z
    .boolean()
    .optional()
    .describe(
      "Enable continuous cloud backup. Required for production durability and prerequisite for PIT restore."
    ),
  pitEnabled: z
    .boolean()
    .optional()
    .describe(
      "Enable point-in-time restore. Requires backupEnabled to also be true."
    ),
  terminationProtectionEnabled: z
    .boolean()
    .optional()
    .describe("Block accidental cluster deletion. Recommended for production."),
  paused: z
    .boolean()
    .optional()
    .describe(
      "Pause/resume the cluster. Set to true to pause (cluster must be IDLE first; the API rejects pause requests on non-IDLE clusters). " +
        "Set to false to resume."
    ),
  encryptionAtRestProvider: z.enum(["NONE", "AWS", "AZURE", "GCP"]).optional(),
  rootCertType: z.enum(["ISRGROOTX1"]).optional(),
  versionReleaseSystem: z.enum(["LTS", "CONTINUOUS"]).optional(),
  tags: z
    .array(tagSchema)
    .optional()
    .describe("Resource tags for cost reporting / organization."),
  replicationSpecs: z
    .array(replicationSpecSchema)
    .min(1)
    .describe(
      "One entry per shard. For REPLICASET use exactly one entry. " +
        "Each entry's regionConfigs[] holds the per-region node configs and is the lever for multi-region HA."
    ),
};

export const clusterConfigSchema = z.object(clusterConfigSchemaRaw);
export type ClusterConfig = z.infer<typeof clusterConfigSchema>;

const READ_ONLY_TOP_LEVEL_FIELDS = [
  "id",
  "groupId",
  "stateName",
  "createDate",
  "connectionStrings",
  "featureCompatibilityVersion",
  "acceptDataRisksAndForceReplicaSetReconfig",
] as const;

const READ_ONLY_NESTED_REPLICATION_SPEC_FIELDS = ["id", "zoneId"] as const;

/**
 * Strip server-only fields so the returned config round-trips into atlas-update-cluster
 * without manual reshaping by the agent. mongoDBVersion is also stripped (mongoDBMajorVersion
 * is what's accepted on update).
 */
export function stripReadOnlyFields(
  cluster: Record<string, unknown>
): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...cluster };
  for (const field of READ_ONLY_TOP_LEVEL_FIELDS) {
    delete stripped[field];
  }
  delete stripped.mongoDBVersion;
  if (Array.isArray(stripped.replicationSpecs)) {
    stripped.replicationSpecs = (
      stripped.replicationSpecs as Array<Record<string, unknown>>
    ).map((spec) => {
      const next = { ...spec };
      for (const field of READ_ONLY_NESTED_REPLICATION_SPEC_FIELDS) {
        delete next[field];
      }
      return next;
    });
  }
  return stripped;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm run build
```

Expected: build succeeds. (Nothing imports the new file yet, so this just verifies the schema itself compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/tools/atlas/shared/clusterConfig.ts
git commit -m "feat(atlas): add shared clusterConfig Zod schema for paid cluster tools"
```

---

## Task 3: Implement `atlas-create-cluster`

**Files:**

- Create: `src/tools/atlas/create/createCluster.ts`

- [ ] **Step 1: Create the tool file**

Create `src/tools/atlas/create/createCluster.ts` with:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import { AtlasArgs } from "../../args.js";
import { clusterConfigSchemaRaw } from "../shared/clusterConfig.js";

export class CreateClusterTool extends AtlasToolBase {
  static toolName = "atlas-create-cluster";
  public description =
    "Create a paid (dedicated/flex) MongoDB Atlas cluster with full control over topology, regions, instance size, autoscaling, and backup. " +
    "For a free M0 cluster, prefer atlas-create-free-cluster. " +
    "This tool maps directly to the Atlas Admin API createCluster endpoint — supply the full ClusterDescription body via the named arguments. " +
    "Reference example bodies live in hackathon-examples/.";
  static operationType: OperationType = "create";
  public argsShape = {
    projectId: AtlasArgs.projectId().describe(
      "Atlas project ID to create the cluster in"
    ),
    ...clusterConfigSchemaRaw,
  };

  protected async execute({
    projectId,
    ...config
  }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
    await ensureCurrentIpInAccessList(this.apiClient, projectId);
    const body = config as unknown as ClusterDescription20240805;
    const cluster = await this.apiClient.createCluster({
      params: { path: { groupId: projectId } },
      body,
    });
    return {
      content: [
        {
          type: "text",
          text: `Cluster "${cluster.name ?? config.name}" requested in project ${projectId} (state: ${cluster.stateName ?? "CREATING"}).`,
        },
        {
          type: "text",
          text: "Double check your access lists to enable your current IP.",
        },
      ],
    };
  }
}
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: succeeds. If TypeScript complains about the spread of `clusterConfigSchemaRaw` into `argsShape`, verify Task 2 exported `clusterConfigSchemaRaw` (the raw object), not just `clusterConfigSchema` (the wrapped object).

- [ ] **Step 3: Commit**

```bash
git add src/tools/atlas/create/createCluster.ts
git commit -m "feat(atlas): add atlas-create-cluster tool"
```

---

## Task 4: Implement `atlas-get-cluster`

**Files:**

- Create: `src/tools/atlas/read/getCluster.ts`

- [ ] **Step 1: Create the tool file**

Create `src/tools/atlas/read/getCluster.ts` with:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type OperationType,
  type ToolArgs,
  formatUntrustedData,
} from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs } from "../../args.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import { stripReadOnlyFields } from "../shared/clusterConfig.js";

export class GetClusterTool extends AtlasToolBase {
  static toolName = "atlas-get-cluster";
  public description =
    "Get the full configuration of an Atlas cluster, in the exact shape accepted by atlas-update-cluster. " +
    "ALWAYS call this before atlas-update-cluster: read → modify the returned config → pass it back to update. " +
    "This avoids accidentally clearing arrays like replicationSpecs (which the API replaces wholesale on PATCH).";
  static operationType: OperationType = "read";
  public argsShape = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
  };

  protected async execute({
    projectId,
    clusterName,
  }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
    try {
      const cluster = await this.apiClient.getCluster({
        params: { path: { groupId: projectId, clusterName } },
      });
      const config = stripReadOnlyFields(
        cluster as unknown as Record<string, unknown>
      );
      return {
        content: [
          {
            type: "text",
            text: `State: ${cluster.stateName ?? "UNKNOWN"} | MongoDB ${cluster.mongoDBVersion ?? "?"} | id: ${cluster.id ?? "?"} | paused: ${cluster.paused ?? false}`,
          },
          {
            type: "text",
            text: "Update-ready config (pass these fields directly to atlas-update-cluster):",
          },
          ...formatUntrustedData(
            "Cluster config:",
            JSON.stringify(config, null, 2)
          ),
        ],
      };
    } catch (err) {
      if (err instanceof ApiClientError && err.response.status === 404) {
        return {
          content: [
            {
              type: "text",
              text: `Cluster "${clusterName}" not found in project ${projectId}. Use atlas-list-clusters to see what exists.`,
            },
          ],
          isError: true,
        };
      }
      throw err;
    }
  }
}
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/tools/atlas/read/getCluster.ts
git commit -m "feat(atlas): add atlas-get-cluster tool"
```

---

## Task 5: Implement `atlas-update-cluster`

**Files:**

- Create: `src/tools/atlas/update/updateCluster.ts`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p src/tools/atlas/update
```

Create `src/tools/atlas/update/updateCluster.ts` with:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OperationType, type ToolArgs } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import { clusterConfigSchemaRaw } from "../shared/clusterConfig.js";

export class UpdateClusterTool extends AtlasToolBase {
  static toolName = "atlas-update-cluster";
  public description =
    "Update an existing Atlas cluster. " +
    "Workflow: ALWAYS call atlas-get-cluster first, modify the returned config in memory, then pass the full modified config here. " +
    "This avoids accidentally clearing arrays like replicationSpecs or tags (the API replaces these wholesale). " +
    "To pause, set paused: true (cluster must be IDLE first); to resume, set paused: false. " +
    "If the cluster is not IDLE the API will reject the change — wait and retry.";
  static operationType: OperationType = "update";
  public argsShape = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Cluster to update"),
    ...clusterConfigSchemaRaw,
  };

  protected async execute({
    projectId,
    clusterName,
    ...config
  }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
    try {
      const body = config as unknown as ClusterDescription20240805;
      const cluster = await this.apiClient.updateCluster(
        projectId,
        clusterName,
        body
      );
      return {
        content: [
          {
            type: "text",
            text: `Cluster "${clusterName}" update requested (state: ${cluster.stateName ?? "UPDATING"}, paused: ${cluster.paused ?? false}).`,
          },
        ],
      };
    } catch (err) {
      if (err instanceof ApiClientError && err.response.status === 404) {
        return {
          content: [
            {
              type: "text",
              text: `Cluster "${clusterName}" not found in project ${projectId}. Use atlas-list-clusters to see what exists.`,
            },
          ],
          isError: true,
        };
      }
      throw err;
    }
  }
}
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/tools/atlas/update/updateCluster.ts
git commit -m "feat(atlas): add atlas-update-cluster tool"
```

---

## Task 6: Register the three new tools

**Files:**

- Modify: `src/tools/atlas/tools.ts`

- [ ] **Step 1: Add re-exports**

Append to `src/tools/atlas/tools.ts` (the file is currently 18 lines of `export { ... }` lines — add three more, grouping with the related categories for readability):

```ts
export { CreateClusterTool } from "./create/createCluster.js";
export { GetClusterTool } from "./read/getCluster.js";
export { UpdateClusterTool } from "./update/updateCluster.js";
```

The full file should now look like (existing content + the three new lines):

```ts
export { ListClustersTool } from "./read/listClusters.js";
export { ListProjectsTool } from "./read/listProjects.js";
export { InspectClusterTool } from "./read/inspectCluster.js";
export { CreateFreeClusterTool } from "./create/createFreeCluster.js";
export { CreateAccessListTool } from "./create/createAccessList.js";
export { InspectAccessListTool } from "./read/inspectAccessList.js";
export { ListDBUsersTool } from "./read/listDBUsers.js";
export { CreateDBUserTool } from "./create/createDBUser.js";
export { CreateProjectTool } from "./create/createProject.js";
export { ListOrganizationsTool } from "./read/listOrgs.js";
export { ConnectClusterTool } from "./connect/connectCluster.js";
export { ListAlertsTool } from "./read/listAlerts.js";
export { GetPerformanceAdvisorTool } from "./read/getPerformanceAdvisor.js";
export { StreamsDiscoverTool } from "./streams/discover.js";
export { StreamsBuildTool } from "./streams/build.js";
export { StreamsManageTool } from "./streams/manage.js";
export { StreamsTeardownTool } from "./streams/teardown.js";
export { CreateClusterTool } from "./create/createCluster.js";
export { GetClusterTool } from "./read/getCluster.js";
export { UpdateClusterTool } from "./update/updateCluster.js";
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: succeeds; the three new tools are now registered in `AllTools`.

- [ ] **Step 3: Commit**

```bash
git add src/tools/atlas/tools.ts
git commit -m "feat(atlas): register paid cluster CRUD tools"
```

---

## Task 7: Repo checks (lint, format, types, api-extractor)

**Files:**

- Possibly modify: `api-extractor/reports/*` (auto-generated)

- [ ] **Step 1: Run the full check suite**

```bash
pnpm run check
```

Expected: passes. If `check:api` reports a diff, that's normal — proceed to step 2. Any other failure (lint, format, types) needs to be fixed before continuing.

- [ ] **Step 2: If `check:api` flagged a diff, refresh reports**

```bash
pnpm run update:api
```

This rewrites files under `api-extractor/reports/`.

- [ ] **Step 3: Re-run checks to confirm green**

```bash
pnpm run check
```

Expected: passes.

- [ ] **Step 4: Commit any api-extractor updates**

```bash
git status --short        # see what changed
git add api-extractor/reports/
git commit -m "chore: update api-extractor reports for paid cluster tools"
```

(If `git status` shows nothing under `api-extractor/`, skip this commit.)

---

## Task 8: Manual smoke test — MCP Inspector (Path A from the spec)

**Files:** none (verification only).

- [ ] **Step 1: Export cloud-dev credentials**

```bash
export MDB_MCP_API_CLIENT_ID="...cloud-dev service-account client id..."
export MDB_MCP_API_CLIENT_SECRET="...cloud-dev secret..."
export MDB_MCP_API_BASE_URL="https://cloud-dev.mongodb.com"
```

- [ ] **Step 2: Launch the inspector**

```bash
pnpm run inspect
```

Open the URL printed in the terminal.

- [ ] **Step 3: Confirm auth works**

Call `atlas-list-projects`. Expected: returns the cloud-dev projects accessible to the service account.

- [ ] **Step 4: Note an empty cloud-dev project ID**

Use one from the list, or create a fresh project via `atlas-create-project`. Record the ID — call it `<PROJECT_ID>` for the rest of these steps.

- [ ] **Step 5: A1 — Create dev-tier cluster**

Call `atlas-create-cluster` with:

```json
{
  "projectId": "<PROJECT_ID>",
  "name": "smoke-dev",
  "clusterType": "REPLICASET",
  "replicationSpecs": [
    {
      "zoneName": "Zone 1",
      "regionConfigs": [
        {
          "providerName": "AWS",
          "regionName": "US_EAST_1",
          "priority": 7,
          "electableSpecs": { "instanceSize": "M10", "nodeCount": 3 },
          "autoScaling": {
            "compute": {
              "enabled": true,
              "scaleDownEnabled": true,
              "minInstanceSize": "M10",
              "maxInstanceSize": "M30"
            },
            "diskGB": { "enabled": true }
          }
        }
      ]
    }
  ]
}
```

Expected: tool returns success text; `smoke-dev` appears in the cloud-dev Atlas UI in `CREATING` state.

- [ ] **Step 6: A2 — Get cluster config**

Call `atlas-get-cluster` with `{ "projectId": "<PROJECT_ID>", "clusterName": "smoke-dev" }`.

Expected: response has two text parts — a state line, and the full config JSON. The JSON must NOT contain `id`, `stateName`, `mongoDBVersion`, `connectionStrings`, `createDate`, `groupId`, `featureCompatibilityVersion`. It SHOULD contain `name`, `clusterType`, `replicationSpecs[]`, `paused`, etc.

- [ ] **Step 7: A3 — Round-trip update (termination protection)**

Take the JSON from step 6, set `terminationProtectionEnabled: true`, and call `atlas-update-cluster` with `{ "projectId": "<PROJECT_ID>", "clusterName": "smoke-dev", ...thatJson }`.

Expected: success text; subsequent `atlas-get-cluster` shows `terminationProtectionEnabled: true`.

- [ ] **Step 8: A4 — Pause via update**

**First wait for the cluster to reach `IDLE`** in the Atlas UI (the API will 4xx/4xy if you try to pause while still creating).

Take the latest config (re-call `atlas-get-cluster`), set `paused: true`, send via `atlas-update-cluster`.

Expected: success; cluster transitions to `PAUSED` in the Atlas UI.

- [ ] **Step 9: A5 — Budget-prod cluster**

Call `atlas-create-cluster` with `name: "smoke-budget"` and:

```json
{
  "clusterType": "REPLICASET",
  "backupEnabled": true,
  "replicationSpecs": [
    {
      "zoneName": "Zone 1",
      "regionConfigs": [
        {
          "providerName": "AWS",
          "regionName": "US_EAST_1",
          "priority": 7,
          "electableSpecs": { "instanceSize": "M30", "nodeCount": 3 },
          "autoScaling": {
            "compute": {
              "enabled": true,
              "scaleDownEnabled": true,
              "minInstanceSize": "M30",
              "maxInstanceSize": "M60"
            },
            "diskGB": { "enabled": true }
          }
        }
      ]
    }
  ]
}
```

Expected: cluster created; matches the `example_3` rubric (M30, AWS US_EAST_1, autoscale on, backup on).

- [ ] **Step 10: A6 — HA-prod multi-region cluster**

Call `atlas-create-cluster` with `name: "smoke-ha"` and:

```json
{
  "clusterType": "REPLICASET",
  "backupEnabled": true,
  "replicationSpecs": [
    {
      "zoneName": "Zone 1",
      "regionConfigs": [
        {
          "providerName": "AWS",
          "regionName": "US_EAST_1",
          "priority": 7,
          "electableSpecs": { "instanceSize": "M30", "nodeCount": 3 },
          "autoScaling": {
            "compute": { "enabled": true, "maxInstanceSize": "M60" },
            "diskGB": { "enabled": true }
          }
        },
        {
          "providerName": "AWS",
          "regionName": "US_WEST_2",
          "priority": 6,
          "electableSpecs": { "instanceSize": "M30", "nodeCount": 2 },
          "autoScaling": {
            "compute": { "enabled": true, "maxInstanceSize": "M60" },
            "diskGB": { "enabled": true }
          }
        },
        {
          "providerName": "AWS",
          "regionName": "US_EAST_2",
          "priority": 5,
          "electableSpecs": { "instanceSize": "M30", "nodeCount": 2 },
          "autoScaling": {
            "compute": { "enabled": true, "maxInstanceSize": "M60" },
            "diskGB": { "enabled": true }
          }
        }
      ]
    }
  ]
}
```

Expected: cluster created with 3 region configs; total electable nodes = 7 (≥5); matches `example_4` rubric.

- [ ] **Step 11: A7 — 404 on missing cluster**

Call `atlas-get-cluster` with `clusterName: "does-not-exist"`.

Expected: a clean text result (not a thrown exception) saying the cluster wasn't found. `isError: true` set.

- [ ] **Step 12: A8 — Cleanup**

Either via the Atlas UI or:

```bash
pnpm run atlas:cleanup
```

Confirm the three smoke clusters are gone.

---

## Task 9: Manual smoke — Claude Code session (Path B from the spec)

**Files:** none. This is the qualitative observation pass that mirrors how case_8 evals run the agent.

- [ ] **Step 1: Configure Claude Code MCP entry**

Add to your Claude Code MCP config (e.g. `~/.claude.json` `mcpServers` block, or a per-project `.claude.json`):

```json
{
  "mcpServers": {
    "mongodb-mcp-paid-clusters": {
      "command": "/absolute/path/to/node",
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

Use the absolute `node` path from `which node` (per HACKATHON.md §5.3 — GUI clients don't inherit shell PATH). If editing code between sessions, rebuild with `pnpm run build` and restart the MCP client.

- [ ] **Step 2: B1 — Dev cluster prompt**

Open a fresh Claude Code session pointed at an **empty** cloud-dev project. Prompt:

> "Create the lowest-cost auto-scaling cluster you can in project `<id>` on AWS."

Pass criterion: cluster has M10 (or M20), single AWS region, autoscale compute+disk on. Note the tool calls used.

- [ ] **Step 3: B2 — Budget production prompt**

Fresh session, empty cloud-dev project. Prompt:

> "I need a budget production cluster in project `<id>`. Razor-thin margins, M-F 9–5 only, weekend downtime fine, 150GB DB, ~50 connections peaking to 500 quarterly. AWS us-east-1. Create it and pause it."

Pass criterion: M30+ REPLICASET, single US_EAST_1, autoscale + backup on, paused after create.

- [ ] **Step 4: B3 — HA production prompt**

Fresh session, empty cloud-dev project. Prompt:

> "Create a multi-region HA production cluster in project `<id>`. AWS, must survive a full region outage, SRE mandates ≥3 regions with electable nodes. 1TB, ~1000 connections peaking 8000 in flash sales. Pause it once created."

Pass criterion: M30+, 3+ AWS regions w/ electable nodes, ≥5 electable total, US_EAST_1 included, autoscale + backup on, paused.

- [ ] **Step 5: B4 — Round-trip update prompt**

Fresh session pointed at a project containing `smoke-budget` (re-create from Task 8 if cleaned up). Prompt:

> "On the cluster `smoke-budget`, turn termination protection on."

Pass criterion: tool-call log shows `atlas-get-cluster` called _before_ `atlas-update-cluster`; update succeeds with no 4xx; `terminationProtectionEnabled` is `true` afterwards.

- [ ] **Step 6: Capture qualitative observations**

For each session above, note:

- Did the agent call `atlas-get-cluster` before `atlas-update-cluster`? (If not, sharpen the description.)
- Did the create body have the right shape on first try? (If 2+ failed creates, sharpen `.describe()` text on the offending fields.)
- Did the agent know to pause via update, or hunt for a separate pause tool? (If hunting, surface the pause guidance more prominently in the update tool description.)

These three signals are the qualitative output of the hackathon test pass. Record them anywhere convenient (e.g. append a section to the spec doc or a separate notes file).

- [ ] **Step 7: Cleanup**

```bash
pnpm run atlas:cleanup
```
