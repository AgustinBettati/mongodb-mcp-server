import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OperationType, type ToolArgs } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import { clusterConfigUpdateSchemaRaw } from "../shared/clusterConfig.js";

export class UpdateClusterTool extends AtlasToolBase {
    static toolName = "atlas-update-cluster";
    public description =
        "Update an existing Atlas cluster. All config fields are OPTIONAL — send only what you want to change. " +
        "Two distinct workflows:\n" +
        "1. CONFIG CHANGES (resize, region changes, backup/termination toggles, tags, etc.): ALWAYS call atlas-get-cluster first, " +
        "modify the returned config, and pass the FULL modified config here. The API replaces arrays like replicationSpecs and tags wholesale, " +
        "so a partial config-change body would silently clear them.\n" +
        "2. PAUSE/RESUME: Atlas REJECTS requests that combine `paused` with any other config field. To pause or resume, " +
        "send ONLY { projectId, clusterName, paused: true|false } — no name, no replicationSpecs, no other fields. " +
        "Cluster must be IDLE before it can be paused; the API rejects pause requests on non-IDLE clusters.";
    static operationType: OperationType = "update";
    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID"),
        clusterName: AtlasArgs.clusterName().describe("Cluster to update"),
        ...clusterConfigUpdateSchemaRaw,
    };

    protected async execute({
        projectId,
        clusterName,
        ...config
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        try {
            // Drop undefined keys so the PATCH body contains only fields the agent set.
            const body = Object.fromEntries(
                Object.entries(config).filter(([, v]) => v !== undefined)
            ) as unknown as ClusterDescription20240805;
            const cluster = await this.apiClient.updateCluster(projectId, clusterName, body);
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
