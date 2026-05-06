import { z } from "zod";

const electableSpecsSchema = z.object({
    instanceSize: z
        .enum(["M0", "M2", "M5", "M10", "M20", "M30", "M40", "M50", "M60", "M80", "M140", "M200", "M300", "M400", "M700"])
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
    diskIOPS: z.number().int().optional().describe("Provisioned IOPS for AWS provisioned storage. Leave unset to use defaults."),
    ebsVolumeType: z.enum(["STANDARD", "PROVISIONED"]).optional(),
});

const computeAutoScalingSchema = z.object({
    enabled: z.boolean().describe("Master toggle for compute (instance size) autoscaling within this region config."),
    scaleDownEnabled: z
        .boolean()
        .optional()
        .describe("Allow autoscale-down. When true, minInstanceSize is required."),
    minInstanceSize: z
        .string()
        .optional()
        .describe("Lower bound (e.g. 'M10'). Required when scaleDownEnabled is true."),
    maxInstanceSize: z
        .string()
        .optional()
        .describe("Upper bound (e.g. 'M40'). Required when enabled is true."),
});

const diskAutoScalingSchema = z.object({
    enabled: z.boolean().describe("Master toggle for storage autoscaling. Strongly recommended for any production cluster."),
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
        .describe("Required when providerName is TENANT — the underlying provider for the free/flex tier."),
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
        .describe("Read-only (non-voting) nodes for additional read capacity. Avoid for budget tiers."),
    analyticsSpecs: electableSpecsSchema
        .partial()
        .optional()
        .describe("Analytics (non-voting, isolated) nodes for analytics workloads. Avoid for budget tiers."),
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
        .describe("MongoDB major version (e.g. '7.0'). Optional; Atlas picks a default if unset."),
    backupEnabled: z
        .boolean()
        .optional()
        .describe("Enable continuous cloud backup. Required for production durability and prerequisite for PIT restore."),
    pitEnabled: z
        .boolean()
        .optional()
        .describe("Enable point-in-time restore. Requires backupEnabled to also be true."),
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
    tags: z.array(tagSchema).optional().describe("Resource tags for cost reporting / organization."),
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
export function stripReadOnlyFields(cluster: Record<string, unknown>): Record<string, unknown> {
    const stripped: Record<string, unknown> = { ...cluster };
    for (const field of READ_ONLY_TOP_LEVEL_FIELDS) {
        delete stripped[field];
    }
    delete stripped.mongoDBVersion;
    if (Array.isArray(stripped.replicationSpecs)) {
        stripped.replicationSpecs = (stripped.replicationSpecs as Array<Record<string, unknown>>).map((spec) => {
            const next = { ...spec };
            for (const field of READ_ONLY_NESTED_REPLICATION_SPEC_FIELDS) {
                delete next[field];
            }
            return next;
        });
    }
    return stripped;
}
