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
