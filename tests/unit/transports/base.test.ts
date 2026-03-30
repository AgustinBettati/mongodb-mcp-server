import { describe, it, expect } from "vitest";
import {
    TransportRunnerBase,
    type TransportRunnerConfig,
    type CustomizableServerOptions,
    type ServerCradle,
} from "../../../src/transports/base.js";
import { LoggerBase } from "../../../src/common/logging/loggerBase.js";
import { CompositeLogger, NullLogger } from "../../../src/common/logging/index.js";
import { Keychain } from "../../../src/common/keychain.js";
import { UserConfigSchema } from "../../../src/common/config/userConfig.js";
import type { UserConfig } from "../../../src/common/config/userConfig.js";
import type { LogLevel, LogPayload } from "../../../src/common/logging/index.js";
import { mongoLogId } from "mongodb-log-writer";
import { MockMetrics } from "../mocks/metrics.js";
import { DIContainer } from "../../../src/common/diContainer.js";

// Minimal concrete subclass — only implements the abstract methods
class TestRunner extends TransportRunnerBase {
    constructor(config: TransportRunnerConfig) {
        super(config);
    }
    async start(_opts: { serverOptions?: CustomizableServerOptions } = {}) {
        return;
    }
    async closeTransport() {
        return;
    }
    // Expose protected methods for testing
    createServer(
        ...args: Parameters<TransportRunnerBase["createServer"]>
    ): ReturnType<TransportRunnerBase["createServer"]> {
        return super.createServer(...args);
    }
    createServerContainer(
        ...args: Parameters<TransportRunnerBase["createServerContainer"]>
    ): ReturnType<TransportRunnerBase["createServerContainer"]> {
        return super.createServerContainer(...args);
    }
}

// Minimal LoggerBase subclass that records log calls
class SpyLogger extends LoggerBase {
    protected readonly type = "console" as const;
    readonly messages: string[] = [];
    constructor() {
        super(undefined);
    }
    protected logCore(_level: LogLevel, payload: LogPayload): void {
        this.messages.push(payload.message);
    }
}

const testConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: [], // disable all library defaults unless a test explicitly enables them
};

const testPayload: LogPayload = {
    id: mongoLogId(9_999_999),
    context: "test",
    message: "hello from test",
};

describe("TransportRunnerBase — DI logger setup", () => {
    it("includes a consumer-registered logger in the composite", () => {
        const spy = new SpyLogger();

        const runner = new TestRunner({
            userConfig: testConfig,
            metrics: new MockMetrics(),
            configureDependencies: (container) => {
                container.register("loggers", "spy", container.asValue(spy));
            },
        });

        runner.logger.info(testPayload);
        expect(spy.messages).toContain("hello from test");
    });

    it("injects userConfig into a consumer factory via the cradle", () => {
        let injectedConfig: UserConfig | undefined;

        new TestRunner({
            userConfig: testConfig,
            metrics: new MockMetrics(),
            configureDependencies: (container) => {
                container.register(
                    "loggers",
                    "spy",
                    container
                        .asFunction(({ userConfig }) => {
                            injectedConfig = userConfig;
                            return new NullLogger();
                        })
                        .singleton()
                );
            },
        });

        expect(injectedConfig).toBe(testConfig);
    });

    it("injects keychain into a consumer factory via the cradle", () => {
        let injectedKeychain: Keychain | undefined;

        new TestRunner({
            userConfig: testConfig,
            metrics: new MockMetrics(),
            configureDependencies: (container) => {
                container.register(
                    "loggers",
                    "spy",
                    container
                        .asFunction(({ keychain }) => {
                            injectedKeychain = keychain;
                            return new NullLogger();
                        })
                        .singleton()
                );
            },
        });

        expect(injectedKeychain).toBe(Keychain.root);
    });

    it("constructs without error when no loggers are configured", () => {
        expect(() => {
            new TestRunner({
                userConfig: { ...testConfig, loggers: [] },
                metrics: new MockMetrics(),
            });
        }).not.toThrow();
    });

    it("registers the library ConsoleLogger when loggers includes stderr", () => {
        // We verify no error is thrown — ConsoleLogger writes to stderr so we just
        // check the runner constructs without throwing.
        expect(() => {
            new TestRunner({
                userConfig: { ...testConfig, loggers: ["stderr"] },
                metrics: new MockMetrics(),
            });
        }).not.toThrow();
    });

    it("consumer can replace the library default by omitting stderr and registering their own logger", () => {
        const customConsole = new SpyLogger();

        const runner = new TestRunner({
            userConfig: { ...testConfig, loggers: [] },
            metrics: new MockMetrics(),
            configureDependencies: (container) => {
                container.register("loggers", "console", container.asValue(customConsole));
            },
        });

        runner.logger.info(testPayload);
        expect(customConsole.messages).toContain("hello from test");
    });
});

describe("TransportRunnerBase — server-scoped container", () => {
    it("default server container wraps the runner logger", async () => {
        const spy = new SpyLogger();
        const runner = new TestRunner({
            userConfig: testConfig,
            metrics: new MockMetrics(),
            configureDependencies: (container) => {
                container.register("loggers", "spy", container.asValue(spy));
            },
        });

        const server = await runner.createServer();
        server.session.logger.info(testPayload);
        expect(spy.messages).toContain("hello from test");
    });

    it("caller-supplied container overrides the default logger", async () => {
        const runnerSpy = new SpyLogger();
        const serverSpy = new SpyLogger();

        const runner = new TestRunner({
            userConfig: testConfig,
            metrics: new MockMetrics(),
            configureDependencies: (container) => {
                container.register("loggers", "spy", container.asValue(runnerSpy));
            },
        });

        const container = await runner.createServerContainer();
        container.register("logger", container.asValue(new CompositeLogger(serverSpy)));

        const server = await runner.createServer({ container });
        server.session.logger.info(testPayload);

        expect(serverSpy.messages).toContain("hello from test");
        expect(runnerSpy.messages).not.toContain("hello from test");
    });

    it("throws when caller-supplied container is missing required registrations", async () => {
        const runner = new TestRunner({ userConfig: testConfig, metrics: new MockMetrics() });
        // Bare scope with no registrations — all ServerCradle deps are missing
        const container = runner.runnerContainer.createScope<ServerCradle>();
        await expect(runner.createServer({ container })).rejects.toThrow();
    });
});
