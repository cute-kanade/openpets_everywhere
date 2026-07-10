import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { register, normalizeEvents, deliverDue, sync, DEFAULT_COURIER, DELIVERY_EXPIRES_MARGIN_MS, GOOGLE_CLIENT_ID, GOOGLE_SCOPE } from "./index.js";
import { CHROMA_KEY_THRESHOLD, COURIER_SOURCES, SHARED_CROP_BASELINE, findSubstantialAlphaComponents, inspectSource } from "./normalize.js";
const sharp = createRequire(import.meta.url)("../../../web/node_modules/sharp");
let createTestHarness;
try { ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing")); } catch { ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url))); }
const locales = { en: JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8")) };
const manifest = JSON.parse(await readFile(new URL("./openpets.plugin.json", import.meta.url), "utf8"));
const permissions = ["ui:delivery", "auth", "network", "schedule", "storage", "commands", "status"];
const event = (id, start, extra = {}) => ({ id, summary: `Event ${id}`, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(start + 3600000).toISOString() }, ...extra });
const courierNames = ["courier-airdog", "courier-owl", "courier-dragon", "courier-cloud", "courier-bat", "courier-bee", "courier-bear-balloon", "courier-pig-plane", "courier-owl-scout", "courier-firefly", "courier-duck-glider", "courier-dog-helicopter", "courier-cat-balloon", "courier-pigeon"];
assert.deepEqual(COURIER_SOURCES, {
  "courier-airdog": "call_Gf4IiKlgGesVoo7J4J1WUbKl.png",
  "courier-owl": "call_5gGA0u55RaKEFbnGFlGI33zr.png",
  "courier-dragon": "call_ShHY4XO36gg0ObwIrkru0K5c.png",
  "courier-cloud": "call_ta5ayF64kxnBvWANR5UO7bb2.png",
  "courier-bat": "call_kk7FK3D4vAQYInkEjvkqZA3q.png",
  "courier-bee": "call_ncPbM3mf8EchBUh3Whfm1CKf.png",
  "courier-bear-balloon": "call_R7YIF7oK4eo2KVeMCl2iUnLV.png",
  "courier-pig-plane": "exec-51e4263f-296a-409a-893d-3186ac2e780d.png",
  "courier-owl-scout": "exec-55f29d11-4a41-4f2e-9b3b-99fd33fc238c.png",
  "courier-firefly": "exec-8846cac8-bbdc-446a-a2f6-972cfa947b19.png",
  "courier-duck-glider": "exec-8e424ac4-4465-4429-b77a-c4af5c77bf36.png",
  "courier-dog-helicopter": "exec-a3fe6ce9-b9cc-43ac-b7ec-31381c8a0224.png",
  "courier-cat-balloon": "exec-aa759e39-0c5d-47e5-81ca-2b3f86a13312.png",
  "courier-pigeon": "exec-eb381953-adb4-46e2-bed7-9031563ad500.png",
}, "the sole normalizer owns the exact fourteen-source mapping");
assert.deepEqual(SHARED_CROP_BASELINE, { frames: 8, frameSize: 256, padding: 8 }, "all courier sources use the shared eight-frame output baseline");
assert.equal(manifest.version, "1.2.0");
assert.equal(manifest.configSchema.courier.type, "select");
assert.equal(manifest.configSchema.courier.presentation, "sprite-grid");
assert.equal(manifest.configSchema.courier.default, DEFAULT_COURIER);
assert.deepEqual(manifest.configSchema.courier.options.map(({ value, label, previewSprite }) => ({ value, label, previewSprite })), courierNames.map((value) => ({ value, label: `$t:config.courier.${value.slice("courier-".length)}`, previewSprite: value })));
assert.equal("pet" in manifest.configSchema, false, "Calendar Airmail no longer relies on a pet config field");
for (const name of courierNames) {
  const sprite = manifest.assets.sprites[name];
  const source = await inspectSource(COURIER_SOURCES[name]);
  assert.ok(source.width > 0 && source.height > 0, `${name} source is inspected on its full canvas`);
  assert.equal(source.components.length, 8, `${name} source has exactly eight substantial components`);
  assert.deepEqual(sprite, { path: `assets/couriers/${name}.webp`, frameWidth: 256, frameHeight: 256, frames: 8, durationMs: 1200 });
  const asset = new URL(`./${sprite.path}`, import.meta.url);
  const { data, info } = await sharp(asset.pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [2048, 256], `${name} is an eight-frame 2048×256 strip`);
  assert.ok(data.some((_, index) => index % 4 === 3 && data[index] === 0) && data.some((_, index) => index % 4 === 3 && data[index] > 0), `${name} retains transparent pixels`);
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const offset = pixel * 4;
    if (data[offset + 3] <= 16) continue;
    const distance = Math.abs(data[offset] - source.background[0]) + Math.abs(data[offset + 1] - source.background[1]) + Math.abs(data[offset + 2] - source.background[2]);
    assert.ok(distance > CHROMA_KEY_THRESHOLD, `${name} has no opaque chroma spill at output pixel ${pixel}`);
  }
  for (let frame = 0; frame < sprite.frames; frame += 1) {
    const frameData = Buffer.alloc(sprite.frameWidth * sprite.frameHeight * 4);
    for (let y = 0; y < sprite.frameHeight; y += 1) data.copy(frameData, y * sprite.frameWidth * 4, (y * info.width + frame * sprite.frameWidth) * 4, (y * info.width + (frame + 1) * sprite.frameWidth) * 4);
    assert.equal(findSubstantialAlphaComponents(frameData, sprite.frameWidth, sprite.frameHeight).length, 1, `${name} frame ${frame} contains one courier component without neighbor fragments`);
  }
}
assert.equal(normalizeEvents([event("a", 1000), { id: "all", start: { date: "2026-01-01" } }, { id: "gone", status: "cancelled", start: { dateTime: new Date(1).toISOString() }, end: { dateTime: new Date(2).toISOString() } }]).length, 1, "cancellation and all-day events excluded");
const h = createTestHarness(register, { permissions, locales, config: { courier: "courier-owl" }, nowMs: 1_000_000 });
const realNow = Date.now; Date.now = () => h.clock.now();
h.auth.mock({ accessToken: "token", expiresAt: 9_999_999 });
// Ten pages prove pagination and recurring instances (same event id, distinct start) survive normalization.
let page = 0;
h.ctx.net.fetch = async () => ({ status: 200, ok: true, headers: {}, text: "", json: { items: [event(`r${page}`, 1_000_000 + 60_000 + (page + 1) * 20 * 60_000)], nextPageToken: page++ < 9 ? `${page}` : undefined } });
await h.start(); await h.runCommand("connect");
assert.equal(GOOGLE_CLIENT_ID.includes("apps.googleusercontent.com"), true); assert.equal(GOOGLE_SCOPE.endsWith("calendar.events.readonly"), true);
assert.equal(page, 10, "pagination fetches at most ten pages");
assert.equal(h.calls.schedules.has("calendar-airmail-next"), true, "one next delivery timer is armed");
// Restart reconstruction uses durable occurrences and creates only the single next timer.
const restart = createTestHarness(register, { permissions, locales, config: { courier: "courier-owl" }, nowMs: 1_000_000 });
await restart.ctx.storage.set("calendar-airmail-state", h.calls.storage.get("calendar-airmail-state")); restart.auth.mock({ accessToken: "token" }); await restart.start();
assert.equal(restart.calls.schedules.has("calendar-airmail-next"), true);
// Both offsets dispatch exactly once; the ledger prevents replay.
const occurrence = { key: "two-offsets", eventId: "two-offsets", title: "Two offsets", startAt: h.clock.now(), endAt: h.clock.now() + 3600000 };
await h.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [{ key: "calendar.two-offsets.600000", dueAt: h.clock.now(), offset: 600000, occurrence }, { key: "calendar.two-offsets.0", dueAt: h.clock.now(), offset: 0, occurrence }], delivered: [] });
await deliverDue(h.ctx); assert.equal(h.calls.deliveries.length, 2, "both offsets are delivered"); await deliverDue(h.ctx); assert.equal(h.calls.deliveries.length, 2, "delivery ledger prevents duplicates"); const firstCount = h.calls.deliveries.length; await h.ctx.schedule.cancel("calendar-airmail-next");
assert.equal(h.calls.deliveries[0].spec.courier?.kind, "sprite", "delivery references a courier sprite asset");
// Missed beyond two minutes is discarded, not delivered.
await h.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [{ key: "calendar.old.0", dueAt: h.clock.now() - 3 * 60_000, offset: 0, occurrence: { key: "old", eventId: "old", title: "Old", startAt: h.clock.now() - 3 * 60_000, endAt: h.clock.now() } }], delivered: [] }); await h.calls.commands.get("sync-now"); await h.runCommand("test-delivery"); assert.equal(h.calls.deliveries.length > firstCount, true, "test delivery works");
// Missing/legacy config uses the declared courier default, never a pet fallback.
const defaultCourier = createTestHarness(register, { permissions, locales, config: { pet: "legacy-pet" }, nowMs: 2_000_000 }); await defaultCourier.start(); await defaultCourier.runCommand("test-delivery"); assert.equal(defaultCourier.calls.deliveries.length, 1); assert.equal(defaultCourier.calls.deliveries[0].spec.courier?.name, DEFAULT_COURIER);
// A 401 retries once with a refreshed token; invalid_grant becomes reconnect-required.
const retry = createTestHarness(register, { permissions, locales, config: { courier: "courier-owl" }, nowMs: 3_000_000 }); retry.auth.mock({ accessToken: "fresh", expiresAt: 9_999_999 }); retry.net.mock("/events?", { status: 401, json: {} }); await retry.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [], delivered: [] }); await retry.start(); await retry.runCommand("sync-now"); assert.equal(retry.calls.netCalls.length >= 2, true, "401 is retried once");
// Same recurring event id at distinct instance starts is retained, while a later cancelled reconciliation removes it.
assert.equal(normalizeEvents([event("series", 2_000_000), event("series", 3_000_000)]).length, 2, "recurrence instances use their start time");
const batch = createTestHarness(register, { permissions, locales, config: { courier: "courier-owl" }, nowMs: h.clock.now() });
const due = (key, title = "Event") => ({ key, dueAt: h.clock.now(), offset: 0, occurrence: { key, eventId: key, title, startAt: h.clock.now(), endAt: h.clock.now() + 3600000 } });
await batch.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [due("good"), due("bad")], delivered: [] });
const delivered = []; let hostAttempts = 0; batch.ctx.ui.delivery = async (spec) => { if (++hostAttempts === 2) throw new Error("host rejected"); delivered.push(spec); return { dismiss: async () => undefined, onDismiss: () => undefined }; };
await deliverDue(batch.ctx); const partial = batch.calls.storage.get("calendar-airmail-state"); assert.equal(delivered.length, 1, "one accepted delivery persists despite a rejected sibling"); assert.equal(partial.delivered.length, 1); assert.equal(partial.pending.length, 1, "rejected delivery is retained and re-armed"); assert.equal(batch.calls.schedules.has("calendar-airmail-next"), true);
assert.ok(delivered[0].title.length <= 160 && delivered[0].detail.length <= 200 && delivered[0].expiresAt >= h.clock.now() + DELIVERY_EXPIRES_MARGIN_MS, "delivery descriptor has a meaningful future margin");
const rejectedDueAt = partial.pending[0].dueAt; await h.clock.advance("3m"); await deliverDue(batch.ctx); const expiredRetry = batch.calls.storage.get("calendar-airmail-state"); assert.equal(hostAttempts, 2, "retry never moves the original due time beyond grace"); assert.equal(expiredRetry.pending.length, 0); assert.equal(rejectedDueAt < h.clock.now() - 2 * 60_000, true);
// Overlapping calls serialize the read-modify-write state and cannot double-deliver.
await batch.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [due("overlap", "x".repeat(500))], delivered: [] }); let overlap = 0; batch.ctx.ui.delivery = async (spec) => { overlap += 1; await Promise.resolve(); assert.ok(spec.title.length <= 160 && spec.detail.length <= 200); return { dismiss: async () => undefined, onDismiss: () => undefined }; }; await Promise.all([deliverDue(batch.ctx), deliverDue(batch.ctx)]); assert.equal(overlap, 1, "overlap serialization prevents duplicate delivery");
// Missed grace discards stale work; the ledger retains 30 days before applying its cap.
await batch.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [], delivered: [{ key: "older-than-horizon", at: h.clock.now() - 31 * 24 * 60 * 60_000 }, { key: "within-horizon", at: h.clock.now() - 29 * 24 * 60 * 60_000 }] }); await deliverDue(batch.ctx); let pruned = batch.calls.storage.get("calendar-airmail-state"); assert.equal(pruned.delivered.some((entry) => entry.key === "older-than-horizon"), false); assert.equal(pruned.delivered.some((entry) => entry.key === "within-horizon"), true, "30-day ledger entries are retained");
await batch.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [{ ...due("missed"), dueAt: h.clock.now() - 3 * 60_000 }], delivered: Array.from({ length: 5100 }, (_, i) => ({ key: `ledger-${i}`, at: h.clock.now() - i })) }); await deliverDue(batch.ctx); pruned = batch.calls.storage.get("calendar-airmail-state"); assert.equal(pruned.pending.length, 0, "missed grace removes stale delivery"); assert.equal(pruned.delivered.length, 5000, "ledger is bounded after pruning");
// 401 is retried exactly once and invalid_grant clears the durable connection.
const authCase = createTestHarness(register, { permissions, locales, config: { courier: "courier-owl" }, nowMs: h.clock.now() }); await authCase.ctx.storage.set("calendar-airmail-state", { connected: true, occurrences: [], pending: [], delivered: [] }); let requests = 0; let refreshes = 0; authCase.ctx.net.fetch = async () => ({ status: ++requests === 1 ? 401 : 200, ok: requests !== 1, headers: {}, text: "", json: { items: [] } }); authCase.ctx.auth.refresh = async () => ({ accessToken: `refresh-${++refreshes}`, expiresAt: h.clock.now() + 3600000 }); await sync(authCase.ctx); assert.equal(requests, 2, "one 401 retry then success");
authCase.ctx.net.fetch = async () => ({ status: 200, ok: true, headers: {}, text: "", json: { items: [event("cancelled", h.clock.now() + 3600000)] } }); await sync(authCase.ctx); assert.equal(authCase.calls.storage.get("calendar-airmail-state").occurrences.length, 1); authCase.ctx.net.fetch = async () => ({ status: 200, ok: true, headers: {}, text: "", json: { items: [event("cancelled", h.clock.now() + 3600000, { status: "cancelled" })] } }); await sync(authCase.ctx); assert.equal(authCase.calls.storage.get("calendar-airmail-state").occurrences.length, 0, "cancellation reconciliation removes cached occurrence");
authCase.ctx.net.fetch = async () => ({ status: 401, ok: false, headers: {}, text: "", json: {} }); authCase.ctx.auth.refresh = async () => { const error = new Error("revoked"); error.code = "invalid_grant"; throw error; }; await sync(authCase.ctx); assert.equal(authCase.calls.storage.get("calendar-airmail-state").connected, false, "invalid_grant requires reconnect");
Date.now = realNow;
console.log("openpets.calendar-airmail: all checks passed.");
