import type { BuildResolver, DisposableResolver, AwilixContainer, Resolver, BuildResolverOptions } from "awilix";
import { createContainer, asValue, asFunction, asClass } from "awilix";

type NonArrayKeys<T> = { [K in keyof T]: NonNullable<T[K]> extends unknown[] ? never : K }[keyof T];
type ArrayKeys<T> = { [K in keyof T]: NonNullable<T[K]> extends unknown[] ? K : never }[keyof T];
type ArrayElement<T, K extends keyof T> = NonNullable<T[K]> extends (infer E)[] ? E : never;

/**
 * A typed dependency injection container backed by [awilix](https://github.com/jeffijoe/awilix).
 * Dependencies are registered by name and resolved on demand, with all types
 * inferred from the `TCradle` shape.
 *
 * Both single-valued and multi-valued dependencies use the same `register` and
 * `resolve` methods — the cradle type determines which overload applies.
 */
export class DIContainer<TCradle extends object> {
    private readonly container: AwilixContainer<TCradle>;

    constructor(container?: AwilixContainer<TCradle>) {
        this.container = container ?? createContainer();
    }

    /**
     * Registers a single-valued dependency.
     *
     * @example
     * container.register("userConfig", container.asValue(config));
     */
    register<K extends NonArrayKeys<TCradle>>(key: K, resolver: Resolver<TCradle[K]>): void;

    /**
     * Registers one contributor to a multi-valued dependency.
     *
     * Multiple contributors can be registered under the same `key`, each
     * distinguished by a unique `id`. Resolving the key returns all contributors
     * as an array in registration order.
     *
     * @param key - The multi-valued dependency name (e.g. `"loggers"`).
     * @param id - A name that uniquely identifies this contributor within the
     *   collection (e.g. `"console"`, `"disk"`).
     * @param resolver - How to construct this contributor. Typically created
     *   with `container.asValue`, `container.asFunction`, or `container.asClass`.
     *
     * @example
     * container.register(
     *   "loggers",
     *   "cloud",
     *   container.asFunction(({ userConfig }) => new CloudLogger(userConfig.apiKey)).singleton()
     * );
     */
    register<K extends ArrayKeys<TCradle>>(
        key: K,
        id: string,
        resolver: Resolver<NonNullable<ArrayElement<TCradle, K>>>
    ): void;

    register(key: string, idOrResolver: string | Resolver<unknown>, resolver?: Resolver<unknown>): void {
        if (typeof idOrResolver === "string") {
            // Collection registration: store the element under "{key}:{id}" so multiple
            // elements can share the same logical key without overwriting each other.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.container.register({ [`${key}:${idOrResolver}`]: resolver as Resolver<any> });

            // Lazily register the array key itself the first time any element is added.
            // This raw resolver scans all "{key}:*" registrations at resolve-time so it
            // always reflects the full set, regardless of registration order.
            if (!this.container.hasRegistration(key)) {
                this.container.register({ [key]: { resolve: () => this.resolveCollection(key) } });
            }
        } else {
            // Scalar registration: store the resolver directly under the key.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.container.register({ [key]: idOrResolver as Resolver<any> });
        }
    }

    /**
     * Resolves a dependency by name. Single-valued dependencies return the
     * registered value directly; multi-valued dependencies return all
     * contributors as an array in registration order.
     *
     * @example
     * const config = container.resolve("userConfig");   // UserConfig
     * const loggers = container.resolve("loggers");     // LoggerBase[]
     */
    resolve<K extends keyof TCradle>(key: K): TCradle[K] {
        return this.container.resolve(key as string);
    }

    /**
     * Creates a child container that inherits all registrations from this container.
     * Registrations added to the child do not affect the parent.
     *
     * The type parameter `TExtra` describes the additional dependencies the child
     * scope will register. The resulting container's cradle is `TCradle & TExtra`,
     * so factories in the child can inject both parent and child dependencies.
     *
     * @example
     * const serverContainer = runnerContainer.createScope<ServerCradle>();
     * serverContainer.register("logger", serverContainer.asValue(myLogger));
     */
    createScope<TExtra extends object>(): DIContainer<TCradle & TExtra> {
        return new DIContainer(this.container.createScope<TExtra>());
    }

    /**
     * Creates a resolver that wraps a pre-built value.
     *
     * @example
     * container.register("keychain", container.asValue(Keychain.root));
     */
    asValue<T>(value: T): Resolver<T> {
        return asValue(value);
    }

    /**
     * Creates a resolver that calls a factory function to construct the value.
     * Other registered dependencies can be injected by name via destructuring.
     *
     * Chain `.singleton()` to reuse one instance, or `.transient()` (the
     * default) to construct a fresh instance on each resolution.
     *
     * @example
     * container.register(
     *   "loggers",
     *   "cloud",
     *   container.asFunction(({ userConfig, keychain }) =>
     *     new CloudLogger(userConfig.apiKey, keychain)
     *   ).singleton()
     * );
     */
    asFunction<T>(
        fn: (cradle: TCradle) => T,
        opts?: BuildResolverOptions<T>
    ): BuildResolver<T> & DisposableResolver<T> {
        return asFunction(fn, opts);
    }

    /**
     * Creates a resolver that instantiates a class to construct the value.
     * Other registered dependencies can be injected by name via destructuring
     * in the constructor.
     *
     * Chain `.singleton()` to reuse one instance, or `.transient()` (the
     * default) to construct a fresh instance on each resolution.
     *
     * @example
     * container.register(
     *   "loggers",
     *   "cloud",
     *   container.asClass(CloudLogger).singleton()
     * );
     */
    asClass<T>(
        Type: new (cradle: TCradle) => T,
        opts?: BuildResolverOptions<T>
    ): BuildResolver<T> & DisposableResolver<T> {
        return asClass(Type, opts);
    }

    /**
     * Disposes all registered dependencies that have a disposer configured,
     * in reverse registration order.
     */
    async dispose(): Promise<void> {
        await this.container.dispose();
    }

    private resolveCollection(key: string): unknown[] {
        const prefix = `${key}:`;
        return Object.keys(this.container.registrations)
            .filter((n) => n.startsWith(prefix))
            .map((n) => this.container.resolve(n));
    }
}
