import { describe, it, expect, vi } from "vitest";
import { DIContainer } from "../../../src/common/diContainer.js";

type ScalarCradle = {
    name: string;
    count: number;
};

type CollectionCradle = {
    prefix: string;
    tags: string[];
};

class Greeter {
    readonly greeting: string;
    constructor({ name }: { name: string }) {
        this.greeting = `hello, ${name}`;
    }
}

type ClassCradle = {
    name: string;
    greeter: Greeter;
};

describe("DIContainer — scalar registration", () => {
    it("resolves a value registered with asValue", () => {
        const container = new DIContainer<ScalarCradle>();
        container.register("name", container.asValue("world"));
        expect(container.resolve("name")).toBe("world");
    });

    it("resolves a value produced by asFunction", () => {
        const container = new DIContainer<ScalarCradle>();
        container.register("count", container.asValue(3));
        container.register(
            "name",
            container.asFunction(({ count }) => `item-${count}`)
        );
        expect(container.resolve("name")).toBe("item-3");
    });

    it("resolves a value produced by asClass", () => {
        const container = new DIContainer<ClassCradle>();
        container.register("name", container.asValue("Alice"));
        container.register("greeter", container.asClass(Greeter));
        expect(container.resolve("greeter").greeting).toBe("hello, Alice");
    });

    it("asFunction singleton returns the same instance on every resolution", () => {
        const container = new DIContainer<ScalarCradle>();
        container.register("count", container.asValue(0));
        container.register("name", container.asFunction(() => ({ value: "x" }) as unknown as string).singleton());
        expect(container.resolve("name")).toBe(container.resolve("name"));
    });

    it("asFunction transient returns a new instance on every resolution", () => {
        const container = new DIContainer<ScalarCradle>();
        container.register("count", container.asValue(0));
        container.register("name", container.asFunction(() => ({ value: "x" }) as unknown as string).transient());
        expect(container.resolve("name")).not.toBe(container.resolve("name"));
    });

    it("throws when resolving an unregistered key", () => {
        const container = new DIContainer<ScalarCradle>();
        expect(() => container.resolve("name")).toThrow();
    });
});

describe("DIContainer — collection registration", () => {
    it("resolves a single contributor as a one-element array", () => {
        const container = new DIContainer<CollectionCradle>();
        container.register("tags", "a", container.asValue("first"));
        expect(container.resolve("tags")).toEqual(["first"]);
    });

    it("collects multiple contributors in registration order", () => {
        const container = new DIContainer<CollectionCradle>();
        container.register("tags", "a", container.asValue("first"));
        container.register("tags", "b", container.asValue("second"));
        container.register("tags", "c", container.asValue("third"));
        expect(container.resolve("tags")).toEqual(["first", "second", "third"]);
    });

    it("injects scalar dependencies into a collection contributor factory", () => {
        const container = new DIContainer<CollectionCradle>();
        container.register("prefix", container.asValue("tag"));
        container.register("tags", "a", container.asFunction(({ prefix }) => `${prefix}-1`).singleton());
        container.register("tags", "b", container.asFunction(({ prefix }) => `${prefix}-2`).singleton());
        expect(container.resolve("tags")).toEqual(["tag-1", "tag-2"]);
    });

    it("resolves contributors added after the first via the same lazy key", () => {
        const container = new DIContainer<CollectionCradle>();
        container.register("tags", "a", container.asValue("first"));
        expect(container.resolve("tags")).toEqual(["first"]);

        container.register("tags", "b", container.asValue("second"));
        expect(container.resolve("tags")).toEqual(["first", "second"]);
    });

    it("factory receives the correct singleton instance on repeated resolutions", () => {
        const factory = vi.fn(() => "tag");
        const container = new DIContainer<CollectionCradle>();
        container.register("tags", "a", container.asFunction(factory).singleton());
        container.resolve("tags");
        container.resolve("tags");
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it("throws when resolving a collection key with no registered contributors", () => {
        const container = new DIContainer<CollectionCradle>();
        expect(() => container.resolve("tags")).toThrow();
    });
});

type ChildCradle = {
    greeting: string;
};

describe("DIContainer — createScope", () => {
    it("child scope resolves parent registrations", () => {
        const parent = new DIContainer<ScalarCradle>();
        parent.register("name", parent.asValue("world"));

        const child = parent.createScope<ChildCradle>();
        expect(child.resolve("name")).toBe("world");
    });

    it("child scope resolves its own registrations", () => {
        const parent = new DIContainer<ScalarCradle>();
        parent.register("name", parent.asValue("world"));

        const child = parent.createScope<ChildCradle>();
        child.register("greeting", child.asValue("hello"));
        expect(child.resolve("greeting")).toBe("hello");
    });

    it("child scope registrations do not affect parent", () => {
        const parent = new DIContainer<ScalarCradle>();
        parent.register("name", parent.asValue("world"));

        const child = parent.createScope<ChildCradle>();
        child.register("greeting", child.asValue("hello"));

        expect(() => (parent as unknown as DIContainer<ChildCradle>).resolve("greeting")).toThrow();
    });

    it("child factory can inject parent dependencies", () => {
        const parent = new DIContainer<ScalarCradle>();
        parent.register("name", parent.asValue("world"));

        const child = parent.createScope<ChildCradle>();
        child.register("greeting", child.asFunction(({ name }) => `hello, ${name}`).singleton());

        expect(child.resolve("greeting")).toBe("hello, world");
    });
});
