import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OperationType, type ToolArgs, formatUntrustedData } from "../../tool.js";
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

    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        try {
            const cluster = await this.apiClient.getCluster({
                params: { path: { groupId: projectId, clusterName } },
            });
            const config = stripReadOnlyFields(cluster as unknown as Record<string, unknown>);
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
                    ...formatUntrustedData("Cluster config:", JSON.stringify(config, null, 2)),
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
