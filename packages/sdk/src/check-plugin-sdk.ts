/**
 * Contract test for @open-pets/plugin-sdk.
 *
 * This file does double duty: it only compiles if the exported types match the
 * real SDK surface, and at runtime it exercises a sample plugin against a mock
 * context. The `createMockContext` helper below is the recommended pattern for
 * unit-testing a plugin's `start` handler without the desktop app.
 */
import type {
  OpenPetsContext,
  OpenPetsPluginDefinition,
  OpenPetsStatus,
} from "./index.js";

// Self-contained assertions so this types-only package needs no runtime deps.
declare const console: { log(...args: unknown[]): void };
const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? "Assertion failed.");
  },
  equal(actual: unknown, expected: unknown, message?: string): void {
    if (actual !== expected) throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}.`);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
    }
  },
};

interface MockCalls {
  speak: string[];
  react: string[];
  status: OpenPetsStatus[];
  storage: Map<string, unknown>;
  schedules: Map<string, () => void | Promise<void>>;
  commands: Map<string, (values?: Record<string, unknown>) => void | Promise<void>>;
}

/** Build a recording {@link OpenPetsContext} for tests. Copy this into your plugin's tests. */
export function createMockContext(config: Record<string, unknown> = {}): {
  ctx: OpenPetsContext;
  calls: MockCalls;
} {
  const calls: MockCalls = {
    speak: [],
    react: [],
    status: [],
    storage: new Map(),
    schedules: new Map(),
    commands: new Map(),
  };
  const ctx: OpenPetsContext = {
    pet: {
      speak: async (message) => void calls.speak.push(message),
      react: async (reaction) => void calls.react.push(reaction),
      moveBy: async () => undefined,
      wander: async () => undefined,
      moveToHome: async () => undefined,
    },
    schedule: {
      once: async (id, _delayMs, handler) => void calls.schedules.set(id, handler),
      every: async (id, _intervalMs, handler) => void calls.schedules.set(id, handler),
      daily: async (id, _spec, handler) => void calls.schedules.set(id, handler),
      cancel: async (id) => void calls.schedules.delete(id),
      cancelAll: async () => void calls.schedules.clear(),
    },
    storage: {
      get: async (key) => calls.storage.get(key) as never,
      set: async (key, value) => void calls.storage.set(key, value),
      delete: async (key) => void calls.storage.delete(key),
    },
    config: {
      get: async () => config as never,
      onChange: () => () => undefined,
    },
    commands: {
      register: async (command, handler) => void calls.commands.set(command.id, handler),
      unregister: async (id) => void calls.commands.delete(id),
    },
    status: {
      set: async (status) => void calls.status.push(status),
      clear: async () => undefined,
    },
    http: {
      fetch: async () => ({ status: 200, ok: true, headers: {}, text: "" }),
    },
    log: {
      debug: async () => undefined,
      info: async () => undefined,
      warn: async () => undefined,
      error: async () => undefined,
    },
  };
  return { ctx, calls };
}

// A representative plugin, typed against the public contract.
const plugin: OpenPetsPluginDefinition = {
  async start(ctx) {
    await ctx.status.set({ text: "Ready", tone: "info" });
    await ctx.pet.speak("Hello!");
    await ctx.pet.react("waving");
    await ctx.schedule.every("tick", 60_000, async () => {
      await ctx.storage.set("lastTick", "now");
    });
    await ctx.commands.register({ id: "greet", title: "Greet" }, async () => {
      await ctx.pet.speak("Hi again!");
    });
  },
};

const { ctx, calls } = createMockContext();
await plugin.start(ctx);

assert.deepEqual(calls.speak, ["Hello!"]);
assert.deepEqual(calls.react, ["waving"]);
assert.equal(calls.status.length, 1);
assert.ok(calls.schedules.has("tick"));
assert.ok(calls.commands.has("greet"));

// Registered callbacks behave as expected.
await calls.schedules.get("tick")?.();
assert.equal(calls.storage.get("lastTick"), "now");

await calls.commands.get("greet")?.();
assert.deepEqual(calls.speak, ["Hello!", "Hi again!"]);

console.log("Plugin SDK contract tests passed.");
