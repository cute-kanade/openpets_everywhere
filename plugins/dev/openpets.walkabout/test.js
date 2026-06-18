// Tests for openpets.walkabout.
import assert from "node:assert/strict";
import {
  SPEED_DURATION,
  WANDER_DISTANCE,
  PATROL_STEP_X,
  cleanConfig,
  normalizeMode,
  normalizeSpeed,
  normalizeInterval,
  nextPatrolTarget,
  startMode,
  startWander,
  startFollowCursor,
  startPhysics,
  startPatrol,
  register,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(
    new URL("../../../packages/sdk/dist/testing.js", import.meta.url)
  ));
}

// ── normalizeMode ──────────────────────────────────────────────────────────────
assert.equal(normalizeMode("wander"), "wander");
assert.equal(normalizeMode("follow-cursor"), "follow-cursor");
assert.equal(normalizeMode("physics"), "physics");
assert.equal(normalizeMode("patrol"), "patrol");
assert.equal(normalizeMode(undefined), "wander", "undefined defaults to wander");
assert.equal(normalizeMode("fly"), "wander", "unknown mode defaults to wander");
assert.equal(normalizeMode(42), "wander", "non-string defaults to wander");

// ── normalizeSpeed ─────────────────────────────────────────────────────────────
assert.equal(normalizeSpeed("slow"), "slow");
assert.equal(normalizeSpeed("normal"), "normal");
assert.equal(normalizeSpeed("brisk"), "brisk");
assert.equal(normalizeSpeed(undefined), "normal", "undefined defaults to normal");
assert.equal(normalizeSpeed("supersonic"), "normal", "unknown speed defaults to normal");

// ── normalizeInterval ──────────────────────────────────────────────────────────
assert.equal(normalizeInterval("5"), 5000);
assert.equal(normalizeInterval(10), 10000);
assert.equal(normalizeInterval("2"), 2000);
assert.equal(normalizeInterval(undefined), 5000, "undefined defaults to 5s");
assert.equal(normalizeInterval("abc"), 5000, "non-numeric defaults to 5s");
assert.equal(normalizeInterval(0), 5000, "zero out-of-range defaults to 5s");
assert.equal(normalizeInterval(200), 5000, "too large defaults to 5s");
assert.equal(normalizeInterval(3.9), 3000, "fractional is floored");

// ── cleanConfig ────────────────────────────────────────────────────────────────
assert.deepEqual(cleanConfig({}), {
  mode: "wander",
  speed: "normal",
  intervalMs: 5000,
  pauseWhenBusy: true,
});

assert.deepEqual(cleanConfig({ mode: "patrol", speed: "brisk", interval: "2", pauseWhenBusy: false }), {
  mode: "patrol",
  speed: "brisk",
  intervalMs: 2000,
  pauseWhenBusy: false,
});

assert.deepEqual(cleanConfig(null), {
  mode: "wander",
  speed: "normal",
  intervalMs: 5000,
  pauseWhenBusy: true,
}, "null input is treated as empty config");

// pauseWhenBusy: only explicit false disables it
assert.equal(cleanConfig({ pauseWhenBusy: true }).pauseWhenBusy, true);
assert.equal(cleanConfig({ pauseWhenBusy: false }).pauseWhenBusy, false);
assert.equal(cleanConfig({}).pauseWhenBusy, true, "omitted defaults to true");

// ── nextPatrolTarget ───────────────────────────────────────────────────────────
{
  const pos = { x: 500, y: 300 };
  const { target: t1, nextDirection: nd1 } = nextPatrolTarget(pos, true);
  assert.equal(t1.x, 500 + PATROL_STEP_X, "patrol right increases x");
  assert.equal(t1.y, 300, "patrol preserves y");
  assert.equal(nd1, false, "direction flips after right");

  const { target: t2, nextDirection: nd2 } = nextPatrolTarget(pos, false);
  assert.equal(t2.x, 500 - PATROL_STEP_X, "patrol left decreases x");
  assert.equal(nd2, true, "direction flips after left");
}

// ── SPEED_DURATION sanity ──────────────────────────────────────────────────────
assert.ok(SPEED_DURATION.slow > SPEED_DURATION.normal, "slow is slower than normal");
assert.ok(SPEED_DURATION.normal > SPEED_DURATION.brisk, "normal is slower than brisk");

// ── Harness-based tests ────────────────────────────────────────────────────────
const PERMISSIONS = ["pet:move", "events", "pets:read", "status"];
const LOCALES = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("./locales/en.json", import.meta.url),
      "utf8"
    )
  ),
};

// createMockContext for pure ctx tests (mode runners need a ctx)
let createMockContext;
try {
  ({ createMockContext } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createMockContext } = await import(
    new URL("../../../packages/sdk/dist/testing.js", import.meta.url)
  ));
}

function makeMockCtx() {
  const { ctx } = createMockContext({ permissions: PERMISSIONS, locales: LOCALES });
  return ctx;
}

// startMode / individual runners — just verify they return a stop function and don't throw.
for (const mode of ["wander", "follow-cursor", "physics", "patrol"]) {
  const ctx = makeMockCtx();
  const cfg = cleanConfig({ mode });
  const stop = startMode(ctx, cfg);
  assert.equal(typeof stop, "function", `startMode("${mode}") returns a stop function`);
  stop();
}

// startWander / startFollowCursor / startPhysics / startPatrol individually.
{
  const ctx = makeMockCtx();
  const stop = startWander(ctx, cleanConfig({ mode: "wander", speed: "brisk" }));
  assert.equal(typeof stop, "function");
  stop();
}
{
  const ctx = makeMockCtx();
  const stop = startFollowCursor(ctx, cleanConfig({ mode: "follow-cursor", speed: "slow" }));
  assert.equal(typeof stop, "function");
  stop();
}
{
  const ctx = makeMockCtx();
  const stop = startPhysics(ctx, cleanConfig({ mode: "physics", speed: "brisk" }));
  assert.equal(typeof stop, "function");
  stop();
}
{
  const ctx = makeMockCtx();
  const stop = startPatrol(ctx, cleanConfig({ mode: "patrol", speed: "normal" }));
  assert.equal(typeof stop, "function");
  stop();
}

// ── Full plugin lifecycle via createTestHarness ────────────────────────────────
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES });

  // start() invokes the plugin's start handler.
  await h.start();

  // Status should be set after start.
  assert.ok(h.calls.status.length > 0, "plugin sets a status on start");

  // Config change — switches mode; should not throw.
  await h.setConfig({ mode: "patrol", speed: "slow", interval: "10", pauseWhenBusy: true });

  // Agent busy → paused status.
  await h.emit("agent:activity", { active: true });
  const statuses = h.calls.status.map((s) => s.text);
  assert.ok(statuses.some((l) => l.includes("paused") || l.includes("Walkabout")), "status recorded after activity event");

  // Agent idle → resumes.
  await h.emit("agent:activity", { active: false });

  // No schedule errors.
  h.expectNoErrors();

  await h.stop();
}

// Lifecycle with pauseWhenBusy disabled — no status change on busy event.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { mode: "wander", pauseWhenBusy: false },
  });
  await h.start();
  const statusCountBefore = h.calls.status.length;
  await h.emit("agent:activity", { active: true });
  // Since pauseWhenBusy is false, no new status should be pushed.
  assert.equal(h.calls.status.length, statusCountBefore, "no status change when pauseWhenBusy is false");
  await h.stop();
}

console.log("All walkabout tests passed.");
