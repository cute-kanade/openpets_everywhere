import assert from "node:assert/strict";

import { isQuietNow, movementConfig, reschedule, takeWalk } from "./index.js";

assert.equal(isQuietNow({ quietStart: "22:00", quietEnd: "08:00" }, new Date("2026-01-01T23:30:00")), true);
assert.equal(isQuietNow({ quietStart: "22:00", quietEnd: "08:00" }, new Date("2026-01-01T12:00:00")), false);
assert.deepEqual(movementConfig({ movementStyle: "playful", frequency: "often", maxDistance: "medium" }), { style: "playful", intervalMs: 600000, distance: 110, durationMs: 650 });

const calls = [];
const ctx = {
  pet: { wander: async (options) => calls.push(["wander", options]), moveToHome: async () => calls.push(["home"]) },
  schedule: { cancelAll: async () => calls.push(["cancelAll"]), every: async (id, ms, fn) => calls.push(["every", id, ms, fn]) },
  storage: { set: async (key, value) => calls.push(["set", key, value]) },
  status: { set: async (status) => calls.push(["status", status]) },
};

assert.equal(await takeWalk(ctx, { quietHoursEnabled: false, movementStyle: "subtle", maxDistance: "small" }), true);
assert.equal(calls[0][0], "wander");
assert.deepEqual(calls[0][1], { distance: 60, durationMs: 900 });

calls.length = 0;
await reschedule(ctx, { movementStyle: "off" });
assert.deepEqual(calls.map((call) => call[0]), ["cancelAll", "status"]);

calls.length = 0;
await reschedule(ctx, { quietHoursEnabled: false, movementStyle: "subtle", frequency: "rare" });
assert.deepEqual(calls.slice(0, 3).map((call) => call[0]), ["cancelAll", "every", "status"]);
assert.equal(calls[1][1], "wander");
assert.equal(calls[1][2] >= 10 * 60_000, true);

calls.length = 0;
await reschedule(ctx, { quietHoursEnabled: false, movementStyle: "playful", frequency: "often", maxDistance: "medium" });
assert.equal(calls[1][2], 10 * 60_000);

console.log("Wander Buddy plugin tests passed.");
