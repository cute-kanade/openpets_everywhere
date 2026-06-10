/**
 * Contract test for @open-pets/plugin-sdk (SDK v3).
 *
 * This file does double duty: it only compiles if the exported types match the
 * real SDK surface, and at runtime it exercises a sample plugin against a mock
 * context. The full-featured testing harness built on this mock lives in
 * `@open-pets/plugin-sdk/testing` (`createTestHarness`).
 */
import type {
  OpenPetsBubble,
  OpenPetsBubbleHandle,
  OpenPetsContext,
  OpenPetsPluginDefinition,
  OpenPetsStatus,
} from "./index.js";
import { createMockContext } from "./testing.js";

export { createMockContext } from "./testing.js";

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

// A representative v3 plugin, typed against the public contract.
const plugin: OpenPetsPluginDefinition = {
  async start(ctx: OpenPetsContext) {
    await ctx.status.set({ text: "Ready", tone: "info" });
    await ctx.pet.speak("Hello!");
    await ctx.pet.react("waving");
    const bubble: OpenPetsBubbleHandle = await ctx.ui.bubble({
      text: "Break in 5:00",
      sticky: true,
      actions: [{ id: "snooze", label: "Snooze" }, { id: "done", label: "Done", style: "primary" }],
    } satisfies OpenPetsBubble);
    bubble.onAction(async (actionId) => {
      if (actionId === "done") await bubble.dismiss();
    });
    await ctx.schedule.every("tick", 60_000, async () => {
      await ctx.storage.set("lastTick", "now");
    });
    await ctx.schedule.cron("daily-summary", "0 9 * * 1-5", async () => {
      await ctx.storage.set("summaryRan", true);
    });
    ctx.events.on("pet:clicked", () => {
      void ctx.pet.react("celebrating");
    });
    ctx.storage.subscribe("lastTick", () => undefined);
    await ctx.bus.publish("sample/mood", { mood: "happy" });
    await ctx.commands.register({ id: "greet", title: "Greet" }, async () => {
      await ctx.pet.speak("Hi again!");
    });
  },
};

const { ctx, calls, harness } = createMockContext();
await plugin.start(ctx);

assert.deepEqual(calls.speak, ["Hello!", "Break in 5:00"]);
assert.deepEqual(calls.react, ["waving"]);
assert.equal(calls.status.length, 1);
assert.ok(calls.schedules.has("tick"));
assert.ok(calls.schedules.has("daily-summary"));
assert.ok(calls.commands.has("greet"));
assert.equal(calls.bubbles.length, 2, "speak + ui.bubble both produce bubbles");
assert.equal(calls.busPublishes.length, 1);

// Bubble interactions round-trip.
const live = calls.bubbles[1]!;
assert.equal(live.spec.sticky, true);
await harness.fireBubbleAction(live.handle.id, "done");
assert.ok(calls.dismissedBubbles.includes(live.handle.id), "onAction('done') dismissed the bubble");

// Registered callbacks behave as expected.
await calls.schedules.get("tick")?.handler();
assert.equal(calls.storage.get("lastTick"), "now");

// Curated events reach subscribers.
await harness.emit("pet:clicked", { petId: "default" });
assert.deepEqual(calls.react, ["waving", "celebrating"]);

await calls.commands.get("greet")?.handler();
assert.deepEqual(calls.speak, ["Hello!", "Break in 5:00", "Hi again!"]);

const status: OpenPetsStatus = calls.status[0]!;
assert.ok(typeof status === "object" && status.text === "Ready");

console.log("Plugin SDK contract tests passed.");
