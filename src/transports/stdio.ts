import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LogId } from "../common/logging/index.js";
import type { Server } from "../server.js";
import type { CustomizableServerOptions, TransportRunnerConfig } from "./base.js";
import { TransportRunnerBase } from "./base.js";
import type { UserConfig } from "../lib.js";
import type { DefaultMetrics } from "../common/metrics/index.js";

export class StdioRunner<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> extends TransportRunnerBase<TUserConfig, TContext, TMetrics> {
    private server: Server<TUserConfig, TContext> | undefined;

    constructor(config: TransportRunnerConfig<TUserConfig, TMetrics>) {
        super(config);
    }

    async start({
        serverOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
    } = {}): Promise<void> {
        try {
            this.server = await this.createServer({ serverOptions });
            const transport = new StdioServerTransport();

            await this.server.connect(transport);
        } catch (error: unknown) {
            this.logger.emergency({
                id: LogId.serverStartFailure,
                context: "server",
                message: `Fatal error running server: ${error as string}`,
            });
            process.exit(1);
        }
    }

    async closeTransport(): Promise<void> {
        await this.server?.close();
    }
}
