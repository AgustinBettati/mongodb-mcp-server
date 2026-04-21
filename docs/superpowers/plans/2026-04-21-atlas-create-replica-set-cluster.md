# atlas-create-replica-set-cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new MCP tool `atlas-create-replica-set-cluster` that creates a dedicated (M10+) 3-node AWS replica set on Atlas via a minimal 4-argument schema.

**Architecture:** One new `AtlasToolBase` subclass in `src/tools/atlas/create/createReplicaSetCluster.ts`, re-exported from `src/tools/atlas/tools.ts` so it is aggregated into `AllTools`. Provider, node count, priority, and autoscaling are hardcoded — only `projectId`, `name`, `region`, and `instanceSize` are exposed. Dedicated tests are out of scope per the spec; verification is local build + MCP Inspector smoke test + end-to-end prompt through a Claude client.

**Tech Stack:** TypeScript, `AtlasToolBase`, `@modelcontextprotocol/sdk`, Zod, generated Atlas OpenAPI types (`ClusterDescription20240805`), pnpm.

---

## Task 1: Create the new tool class

**Files:**
- Create: `src/tools/atlas/create/createReplicaSetCluster.ts`

- [ ] **Step 1: Write the tool file**

Create `src/tools/atlas/create/createReplicaSetCluster.ts` with exactly this content:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import { AtlasArgs } from "../../args.js";

export class CreateReplicaSetClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-replica-set-cluster";
    public description = "Create a dedicated MongoDB Atlas replica set cluster (M10+).";
    static operationType: OperationType = "create";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID to create the cluster in"),
        name: AtlasArgs.clusterName().describe("Name of the cluster"),
        region: AtlasArgs.region().describe("AWS region of the cluster").default("US_EAST_1"),
        instanceSize: z
            .enum(["M10", "M20", "M30", "M40"])
            .describe("Dedicated instance size")
            .default("M10"),
    };

    protected async execute({
        projectId,
        name,
        region,
        instanceSize,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const input = {
            groupId: projectId,
            name,
            clusterType: "REPLICASET",
            replicationSpecs: [
                {
                    zoneName: "Zone 1",
                    regionConfigs: [
                        {
                            providerName: "AWS",
                            regionName: region,
                            priority: 7,
                            electableSpecs: {
                                instanceSize,
                                nodeCount: 3,
                            },
                        },
                    ],
                },
            ],
            terminationProtectionEnabled: false,
        } as unknown as ClusterDescription20240805;

        await ensureCurrentIpInAccessList(this.apiClient, projectId);
        await this.apiClient.createCluster({
            params: {
                path: {
                    groupId: projectId,
                },
            },
            body: input,
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Replica set cluster "${name}" (${instanceSize}) has been requested in region "${region}".`,
                },
                { type: "text", text: `Double check your access lists to enable your current IP.` },
            ],
        };
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/atlas/create/createReplicaSetCluster.ts
git commit -m "feat: add atlas-create-replica-set-cluster tool"
```

---

## Task 2: Register the tool

**Files:**
- Modify: `src/tools/atlas/tools.ts`

- [ ] **Step 1: Add the re-export**

Append one line to `src/tools/atlas/tools.ts` (alphabetical-by-convention doesn't apply — follow the "create/" grouping that already exists; place the new line directly after `CreateFreeClusterTool`):

```ts
export { CreateReplicaSetClusterTool } from "./create/createReplicaSetCluster.js";
```

After edit, the top of `tools.ts` should look like:

```ts
export { ListClustersTool } from "./read/listClusters.js";
export { ListProjectsTool } from "./read/listProjects.js";
export { InspectClusterTool } from "./read/inspectCluster.js";
export { CreateFreeClusterTool } from "./create/createFreeCluster.js";
export { CreateReplicaSetClusterTool } from "./create/createReplicaSetCluster.js";
// ...rest unchanged
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/atlas/tools.ts
git commit -m "feat: register atlas-create-replica-set-cluster in tools barrel"
```

---

## Task 3: Build and type-check

- [ ] **Step 1: Run the build**

Run: `pnpm run build`
Expected: exits 0, produces `dist/esm/index.js`.

If the build fails with a type error about `ClusterDescription20240805`, the `as unknown as` cast in Task 1 should already handle it — re-read the new file and confirm it matches Task 1 exactly.

- [ ] **Step 2: Run the full check suite**

Run: `pnpm run check`
Expected: lint, types, format, and api-extractor all pass.

If `check:api` fails claiming the public surface changed, run `pnpm run update:api`, inspect the diff under `api-extractor/reports/`, and commit it:

```bash
git add api-extractor/reports
git commit -m "chore: refresh api-extractor reports for new tool"
```

Otherwise no commit is needed for this task.

---

## Task 4: Smoke test with the MCP Inspector

- [ ] **Step 1: Export cloud-dev credentials**

In the shell you will run the inspector from:

```bash
export MDB_MCP_API_CLIENT_ID="...cloud-dev service-account client id..."
export MDB_MCP_API_CLIENT_SECRET="...cloud-dev service-account secret..."
export MDB_MCP_API_BASE_URL="https://cloud-dev.mongodb.com"
```

If you do not yet have a cloud-dev service account, stop and ask the hackathon host for one before continuing.

- [ ] **Step 2: Launch the inspector**

Run: `pnpm run inspect`
Expected: prints an Inspector URL (e.g. `http://localhost:6274`). Open it in a browser.

- [ ] **Step 3: Verify auth and discovery**

In the Inspector:
1. Click **Connect**.
2. Call `atlas-list-projects` with no args. Expected: a non-empty list of cloud-dev projects. This confirms credentials flow through.
3. Locate `atlas-create-replica-set-cluster` in the tool list. Expected: it appears with the four args (`projectId`, `name`, `region`, `instanceSize`) and their defaults/enum values.

- [ ] **Step 4: Invoke the tool**

Pick a throwaway project ID from Step 3. Call `atlas-create-replica-set-cluster` with:

```json
{
  "projectId": "<your-cloud-dev-project-id>",
  "name": "hackathon-rs-inspector",
  "region": "US_EAST_1",
  "instanceSize": "M10"
}
```

Expected: the tool returns two text blocks (`Replica set cluster "hackathon-rs-inspector" (M10) has been requested...` and the access-list reminder). No `ApiClientError` in server logs.

- [ ] **Step 5: Confirm in the Atlas UI**

Open `https://cloud-dev.mongodb.com`, navigate to the project, and confirm `hackathon-rs-inspector` is visible and progressing through creation (state `CREATING` → `IDLE`).

- [ ] **Step 6: Clean up**

Either delete the cluster from the Atlas UI, or let `pnpm run atlas:cleanup` reap it later.

No commit in this task — verification only.

---

## Task 5: End-to-end verification through a Claude client

The spec requires driving the tool from a Claude client with a natural-language prompt. These steps assume Claude Desktop; if the user uses Claude Code's MCP support or Cursor, the JSON block is the same — only the config file path differs.

- [ ] **Step 1: Confirm the built entry point exists**

Run: `ls dist/esm/index.js`
Expected: file exists (created by Task 3). If missing, re-run `pnpm run build`.

Note the absolute path — you will paste it into the Claude config. From the repo root:

```bash
echo "$(pwd)/dist/esm/index.js"
```

- [ ] **Step 2: Configure the Claude client**

Open the client's MCP config file:
- Claude Desktop (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
- Other clients: see the client's docs; the shape is the same.

Add (or merge) the `MongoDB` entry:

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_FROM_STEP_1>"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "...cloud-dev client id...",
        "MDB_MCP_API_CLIENT_SECRET": "...cloud-dev client secret...",
        "MDB_MCP_API_BASE_URL": "https://cloud-dev.mongodb.com"
      }
    }
  }
}
```

Save the file.

- [ ] **Step 3: Restart the Claude client**

Fully quit and relaunch so it re-reads the MCP config and spawns a fresh `node` process.

- [ ] **Step 4: Confirm the tool is registered**

In a new Claude conversation, ask: `"List the MongoDB MCP tools you can see."`
Expected: the response includes `atlas-create-replica-set-cluster` along with the existing Atlas tools. If it does not, check the client's MCP logs — a typo in the config path or a missing `MDB_MCP_API_BASE_URL` will cause the server to silently not register Atlas tools.

- [ ] **Step 5: Drive the tool with a natural-language prompt**

In the same conversation, prompt (substituting a cloud-dev project ID you own):

```
Create a dedicated replica set cluster named "hackathon-rs-claude" in Atlas project <your-cloud-dev-project-id>. Use region US_EAST_1 and instance size M10.
```

Expected:
1. Claude proposes to call `atlas-create-replica-set-cluster` with `projectId`, `name: "hackathon-rs-claude"`, `region: "US_EAST_1"`, `instanceSize: "M10"`.
2. After you approve the tool call, the response contains the two text blocks emitted by the tool.

- [ ] **Step 6: Confirm in cloud-dev and clean up**

Open `https://cloud-dev.mongodb.com`, confirm `hackathon-rs-claude` is creating, then delete it (or let `pnpm run atlas:cleanup` reap it).

No commit in this task — verification only. Report back whether Steps 4–6 succeeded; if any step fails, capture the error message for triage before declaring the tool done.

---

## Done criteria

- [ ] Tool file exists and compiles.
- [ ] Tool is re-exported from `src/tools/atlas/tools.ts`.
- [ ] `pnpm run build` and `pnpm run check` pass.
- [ ] MCP Inspector smoke test creates a cluster in cloud-dev (Task 4).
- [ ] A prompt through the user's Claude client creates a cluster in cloud-dev (Task 5).
- [ ] Test clusters are cleaned up.
