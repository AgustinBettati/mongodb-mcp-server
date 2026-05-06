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
