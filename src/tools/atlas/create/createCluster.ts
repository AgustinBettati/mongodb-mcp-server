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
        projectId: AtlasArgs.projectId().describe("Atlas project ID to create the cluster in"),
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
                { type: "text", text: "Double check your access lists to enable your current IP." },
            ],
        };
    }
}
