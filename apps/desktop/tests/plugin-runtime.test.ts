import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OPENPETS_PLUGIN_MANIFEST_FILENAME, type OpenPetsPluginManifest } from "../src/plugin-manifest.js";
import { type PluginPetApi } from "../src/plugin-pet-api.js";
import { PluginRuntime, type PluginRuntimeScheduler, type PluginTimerHandle } from "../src/plugin-runtime.js";
import { initializePluginState, type PluginStateStore, type PluginStateRecord } from "../src/plugin-state.js";

let currentRoot = "";

class FakeScheduler implements PluginRuntimeScheduler {
  timers: Array<{ delayMs: number; active: boolean; callback: () => void }> = [];
  setTimeout(callback: () => void, delayMs: number): PluginTimerHandle {
    const timer = { delayMs, active: true, callback };
    this.timers.push(timer);
    return { cancel: () => { timer.active = false; } };
  }
  fire(index = 0): void {
    const timer = this.timers[index];
    if (timer?.active) {
      timer.active = false;
      timer.callback();
    }
  }
  activeCount(): number {
    return this.timers.filter((timer) => timer.active).length;
  }
}

class FakePetApi implements PluginPetApi {
  events: string[] = [];
  fail = false;
  deferredFailure: { reject: (error: Error) => void } | undefined;
  speak(message: string): void {
    if (this.fail) throw new Error("pet api failed");
    this.events.push(`speak:${message}`);
  }
  react(reaction: string): void | Promise<void> {
    if (this.deferredFailure) return new Promise((_resolve, reject) => { this.deferredFailure = { reject }; });
    if (this.fail) throw new Error("pet api failed");
    this.events.push(`react:${reaction}`);
  }
}

await scenario("disabled no timers", async ({ store, scheduler }) => {
  addPlugin(store, { enabled: false });
  await runtime(store, scheduler).start();
  assert.equal(scheduler.activeCount(), 0);
});

await scenario("valid timer schedules and fires", async ({ store, scheduler, petApi }) => {
  addPlugin(store, {}, manifest({ permissions: ["timer", "pet:speak", "pet:reaction"], actions: [{ type: "pet.speak", message: "Stretch" }, { type: "pet.react", reaction: "celebrating" }] }));
  await runtime(store, scheduler, petApi).start();
  assert.equal(scheduler.timers[0].delayMs, 5 * 60_000);
  assert.deepEqual(petApi.events, []);
  scheduler.fire(0);
  await Promise.resolve();
  assert.deepEqual(petApi.events, ["speak:Stretch", "react:celebrating"]);
});

await scenario("config speak and reaction refs execute", async ({ store, scheduler, petApi }) => {
  addPlugin(store, { config: { message: "Hello", reaction: "celebrating" } }, manifest({ permissions: ["timer", "pet:speak", "pet:reaction"], configSchema: { message: { type: "text", default: "Stretch" }, reaction: { type: "select", default: "idle", options: [{ label: "Idle", value: "idle" }, { label: "Celebrate", value: "celebrating" }] } }, actions: [{ type: "pet.speak", message: { config: "message" } }, { type: "pet.react", reaction: { config: "reaction" } }] }));
  await runtime(store, scheduler, petApi).start();
  scheduler.fire(0);
  await Promise.resolve();
  assert.deepEqual(petApi.events, ["speak:Hello", "react:celebrating"]);
});

await scenario("invalid persisted config refs mark broken without api call", async ({ store, scheduler, petApi }) => {
  addPlugin(store, { config: { message: 42 } }, manifest({ configSchema: { message: { type: "text", default: "Stretch" } }, actions: [{ type: "pet.speak", message: { config: "message" } }] }));
  await runtime(store, scheduler, petApi).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /invalid/);
  assert.equal(scheduler.activeCount(), 0);
  assert.deepEqual(petApi.events, []);
});

await scenario("final config message and reaction validation applies", async ({ store }) => {
  addPlugin(store, { config: { message: "https://example.test" } }, manifest({ configSchema: { message: { type: "text", default: "Stretch" } }, actions: [{ type: "pet.speak", message: { config: "message" } }] }));
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /URL/);
});

await scenario("unapproved permission broken", async ({ store, scheduler }) => {
  addPlugin(store, { approvedPermissions: ["timer"] }, manifest({ permissions: ["timer", "pet:speak"] }));
  await runtime(store, scheduler).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /not approved/);
  assert.equal(scheduler.activeCount(), 0);
  assert.equal(store.getRecord("plug")?.enabled, true);
});

await scenario("invalid manifest and id-version mismatch broken", async ({ root, store }) => {
  const first = addPlugin(store, {}, { bad: true });
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /validation failed/);
  addPlugin(store, { id: "other" }, manifest({ id: "plug" }));
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("other")?.brokenReason ?? "", /id\/version/);
});

await scenario("invalid reaction and message broken", async ({ store }) => {
  addPlugin(store, {}, manifest({ permissions: ["timer", "pet:reaction"], actions: [{ type: "pet.react", reaction: "celebrate" }] }));
  addPlugin(store, { id: "bad-message" }, manifest({ id: "bad-message", actions: [{ type: "pet.speak", message: "https://example.test" }] }));
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /Invalid pet reaction/);
  assert.match(store.getRecord("bad-message")?.brokenReason ?? "", /URL/);
});

await scenario("config interval below five broken", async ({ store }) => {
  addPlugin(store, { config: { intervalMinutes: 4 } }, manifest({ everyMinutes: { config: "intervalMinutes" }, configSchema: { intervalMinutes: { type: "number", default: 6 } } }));
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /at least 5/);
});

await scenario("stop cancels and stale timers do not fire", async ({ store, scheduler, petApi }) => {
  addPlugin(store);
  const rt = runtime(store, scheduler, petApi);
  await rt.start();
  const stale = scheduler.timers[0];
  rt.stop();
  assert.equal(stale.active, false);
  stale.callback();
  assert.deepEqual(petApi.events, []);
});

await scenario("reload cancels stale timer", async ({ store, scheduler, petApi }) => {
  addPlugin(store);
  const rt = runtime(store, scheduler, petApi);
  await rt.start();
  const stale = scheduler.timers[0];
  await rt.reloadPlugin("plug");
  stale.callback();
  assert.deepEqual(petApi.events, []);
  scheduler.fire(1);
  await Promise.resolve();
  assert.deepEqual(petApi.events, ["speak:Stretch"]);
});

await scenario("path outside install/root and oversized rejected", async ({ root, store }) => {
  const outsideRoot = tempDir();
  addPlugin(store, { installPath: outsideRoot, manifestPath: writeManifest(outsideRoot, manifest()) });
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /outside allowed/);
  const install = join(root, "oversized");
  mkdirSync(install, { recursive: true });
  const path = join(install, OPENPETS_PLUGIN_MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(manifest()) + " ".repeat(200), "utf8");
  store.upsertRecord(record({ id: "oversized", installPath: install, manifestPath: path }));
  await new PluginRuntime({ stateStore: store, petApi: new FakePetApi(), scheduler: new FakeScheduler(), allowedPluginRoots: [root], maxManifestBytes: 100 }).start();
  assert.match(store.getRecord("oversized")?.brokenReason ?? "", /too large/);
});

await scenario("manifest outside install rejected", async ({ root, store }) => {
  const goodInstall = join(root, "good");
  const otherInstall = join(root, "other");
  mkdirSync(goodInstall, { recursive: true });
  const manifestPath = writeManifest(otherInstall, manifest());
  store.upsertRecord(record({ installPath: goodInstall, manifestPath }));
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /outside install/);
});

await scenario("root-level evil manifest filename rejected", async ({ root, store }) => {
  const install = join(root, "evil-name");
  mkdirSync(install, { recursive: true });
  const manifestPath = join(install, `evil-${OPENPETS_PLUGIN_MANIFEST_FILENAME}`);
  writeFileSync(manifestPath, JSON.stringify(manifest()), "utf8");
  store.upsertRecord(record({ installPath: install, manifestPath }));
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /manifest path is invalid/);
});

await scenario("reloadAll cancels removed plugin timers", async ({ store, scheduler, petApi }) => {
  addPlugin(store);
  const rt = runtime(store, scheduler, petApi);
  await rt.start();
  const stale = scheduler.timers[0];
  store.removeRecord("plug");
  await rt.reloadAll();
  assert.equal(stale.active, false);
  stale.callback();
  assert.deepEqual(petApi.events, []);
  assert.equal(scheduler.activeCount(), 0);
});

await scenario("invalid configured timer does not fall back to default", async ({ store }) => {
  addPlugin(store, { config: { intervalMinutes: "10" } }, manifest({ everyMinutes: { config: "intervalMinutes" }, configSchema: { intervalMinutes: { type: "number", default: 6 } } }));
  await runtime(store, new FakeScheduler()).start();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /invalid|must resolve to an integer/);
});

await scenario("timer handles do not accumulate after repeated fires", async ({ store, scheduler, petApi }) => {
  addPlugin(store);
  await runtime(store, scheduler, petApi).start();
  assert.equal(scheduler.activeCount(), 1);
  scheduler.fire(0);
  await Promise.resolve();
  assert.equal(scheduler.activeCount(), 1);
  scheduler.fire(1);
  await Promise.resolve();
  assert.equal(scheduler.activeCount(), 1);
});

await scenario("brokenReason clears and bad plugin not blocking good", async ({ store, scheduler }) => {
  addPlugin(store, { brokenReason: "old" });
  addPlugin(store, { id: "bad" }, manifest({ id: "bad", permissions: ["timer", "pet:reaction"], actions: [{ type: "pet.react", reaction: "celebrate" }] }));
  await runtime(store, scheduler).start();
  assert.equal(store.getRecord("plug")?.brokenReason, undefined);
  assert.match(store.getRecord("bad")?.brokenReason ?? "", /Invalid pet reaction/);
  assert.equal(scheduler.activeCount(), 1);
});

await scenario("pet api failure marks broken", async ({ store, scheduler, petApi }) => {
  addPlugin(store);
  petApi.fail = true;
  await runtime(store, scheduler, petApi).start();
  scheduler.fire(0);
  await Promise.resolve();
  assert.match(store.getRecord("plug")?.brokenReason ?? "", /pet api failed/);
  assert.equal(store.getRecord("plug")?.enabled, true);
});

await scenario("stale reload cannot resurrect disabled plugin", async ({ store, scheduler }) => {
  addPlugin(store);
  const rt = runtime(store, scheduler);
  await rt.start();
  scheduler.timers = [];
  const reload = rt.reloadPlugin("plug");
  const current = store.getRecord("plug");
  assert.ok(current);
  store.upsertRecord({ ...current, enabled: false });
  await rt.reloadPlugin("plug");
  await reload;
  assert.equal(scheduler.activeCount(), 0);
});

await scenario("stale reload cannot resurrect stopped runtime", async ({ store, scheduler }) => {
  addPlugin(store);
  const rt = runtime(store, scheduler);
  await rt.start();
  scheduler.timers = [];
  const reload = rt.reloadPlugin("plug");
  rt.stop();
  await reload;
  assert.equal(scheduler.activeCount(), 0);
});

await scenario("stale async action failure does not break new generation", async ({ store, scheduler, petApi }) => {
  addPlugin(store, {}, manifest({ permissions: ["timer", "pet:reaction"], actions: [{ type: "pet.react", reaction: "celebrating" }] }));
  petApi.deferredFailure = { reject() {} };
  const rt = runtime(store, scheduler, petApi);
  await rt.start();
  scheduler.fire(0);
  const pending = petApi.deferredFailure;
  assert.ok(pending);
  await rt.reloadPlugin("plug");
  pending.reject(new Error("stale failure"));
  await Promise.resolve();
  assert.equal(store.getRecord("plug")?.brokenReason, undefined);
  assert.equal(scheduler.activeCount(), 1);
});

console.error("Plugin runtime validation passed.");

async function scenario(name: string, fn: (ctx: { root: string; store: PluginStateStore; scheduler: FakeScheduler; petApi: FakePetApi }) => Promise<void>): Promise<void> {
  const root = tempDir();
  currentRoot = root;
  const store = initializePluginState({ statePath: join(tempDir(), "state.json") });
  const scheduler = new FakeScheduler();
  const petApi = new FakePetApi();
  try { await fn({ root, store, scheduler, petApi }); } catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

function runtime(store: PluginStateStore, scheduler: FakeScheduler, petApi = new FakePetApi(), roots?: string[]): PluginRuntime {
  return new PluginRuntime({ stateStore: store, petApi, scheduler, allowedPluginRoots: roots ?? [currentRoot] });
}

function addPlugin(store: PluginStateStore, patch: Partial<PluginStateRecord> = {}, data: unknown = manifest()): PluginStateRecord {
  const root = patch.installPath ? join(patch.installPath, "..") : currentRoot;
  const id = patch.id ?? "plug";
  const installPath = patch.installPath ?? join(root, id);
  const manifestPath = patch.manifestPath ?? writeManifest(installPath, data);
  const rec = record({ ...patch, id, installPath, manifestPath });
  store.upsertRecord(rec);
  return rec;
}

function record(patch: Partial<PluginStateRecord> = {}): PluginStateRecord {
  return { id: patch.id ?? "plug", version: patch.version ?? "1.0.0", manifestPath: patch.manifestPath ?? "", installPath: patch.installPath ?? "", source: patch.source ?? "local", enabled: patch.enabled ?? true, approvedPermissions: patch.approvedPermissions ?? ["timer", "pet:speak", "pet:reaction"], config: patch.config ?? {}, brokenReason: patch.brokenReason };
}

function manifest(patch: Partial<OpenPetsPluginManifest> & { everyMinutes?: OpenPetsPluginManifest["triggers"][number]["everyMinutes"]; actions?: OpenPetsPluginManifest["triggers"][number]["actions"] } = {}): OpenPetsPluginManifest {
  return { manifestVersion: 1, id: patch.id ?? "plug", name: "Plug", version: patch.version ?? "1.0.0", runtime: "declarative", permissions: patch.permissions ?? ["timer", "pet:speak"], configSchema: patch.configSchema, triggers: [{ on: "timer", everyMinutes: patch.everyMinutes ?? 5, actions: patch.actions ?? [{ type: "pet.speak", message: "Stretch" }] }] };
}

function writeManifest(dir: string, data: unknown): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, OPENPETS_PLUGIN_MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(data), "utf8");
  return path;
}

function tempDir(): string { return mkdtempSync(join(tmpdir(), "openpets-plugin-runtime-")); }
