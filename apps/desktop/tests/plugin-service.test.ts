import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OPENPETS_PLUGIN_MANIFEST_FILENAME, type OpenPetsPluginManifest } from "../src/plugin-manifest.js";
import { PluginService } from "../src/plugin-service.js";
import { PluginStateStore, type PluginStateRecord } from "../src/plugin-state.js";

let lastRoot = "";

class FakeRuntime {
  reloads: string[] = [];
  stopped = false;
  async start(): Promise<void> {}
  stop(): void { this.stopped = true; }
  async reloadPlugin(id: string): Promise<void> { this.reloads.push(id); }
}

class ThrowingStateStore extends PluginStateStore {
  failNextUpsert = false;
  override upsertRecord(record: PluginStateRecord): PluginStateRecord {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("state write failed");
    }
    return super.upsertRecord(record);
  }
}

await scenario("initializes store and roots", async ({ userData }) => {
  const service = new PluginService({ userDataPath: userData, petApi: { speak() {}, react() {} } });
  await service.start();
  assert.equal(existsSync(join(userData, "plugins")), true);
  assert.equal(existsSync(join(userData, "plugins-dev")), true);
  assert.deepEqual(await service.getSnapshot(), { plugins: [] });
  service.stop();
});

await scenario("snapshot omits paths and includes manifest config", async ({ service, store }) => {
  addPlugin(store, { config: { interval: 7 } }, manifest({ configSchema: { interval: { type: "number", default: 5 } }, everyMinutes: { config: "interval" } }));
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.plugins[0].name, "Plug");
  assert.deepEqual(snapshot.plugins[0].effectiveConfig, { interval: 7 });
  assert.equal("manifestPath" in snapshot.plugins[0], false);
  assert.equal("installPath" in snapshot.plugins[0], false);
});

await scenario("invalid manifest appears safe broken", async ({ service, store }) => {
  addPlugin(store, {}, { bad: true });
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.plugins[0].brokenReason, "Plugin manifest validation failed.");
});

await scenario("missing manifest does not leak absolute paths", async ({ service, store, root }) => {
  const missingPath = join(root, "missing", OPENPETS_PLUGIN_MANIFEST_FILENAME);
  store.upsertRecord({ id: "missing", version: "1.0.0", manifestPath: missingPath, installPath: join(root, "missing"), source: "local", enabled: true, approvedPermissions: ["timer"], config: {} });
  const snapshot = await service.getSnapshot();
  const reason = snapshot.plugins[0].brokenReason ?? "";
  assert.equal(reason, "Plugin manifest is unavailable.");
  assert.equal(reason.includes(root), false);
});

await scenario("stored path-like broken reason is sanitized", async ({ service, store, root }) => {
  addPlugin(store, { brokenReason: `ENOENT: no such file or directory, open '${join(root, "plug", OPENPETS_PLUGIN_MANIFEST_FILENAME)}'` });
  const snapshot = await service.getSnapshot();
  const reason = snapshot.plugins[0].brokenReason ?? "";
  assert.equal(reason, "Plugin needs attention. Check logs for details.");
  assert.equal(reason.includes(root), false);
});

await scenario("config save rejects unknown and non plain", async ({ service, store }) => {
  addPlugin(store, {}, manifest({ configSchema: { interval: { type: "number", default: 5 } }, everyMinutes: { config: "interval" } }));
  assert.equal((await service.saveConfig("plug", { unknown: true })).ok, false);
  assert.equal((await service.saveConfig("plug", new Date())).ok, false);
});

await scenario("config save replaces and reloads", async ({ service, store, runtime }) => {
  addPlugin(store, { config: { text: "old", keep: true } }, manifest({ configSchema: { text: { type: "text" } } }));
  const result = await service.saveConfig("plug", { text: "new" });
  assert.equal(result.ok, true);
  assert.deepEqual(store.getRecord("plug")?.config, { text: "new" });
  assert.deepEqual(runtime.reloads, ["plug"]);
});

await scenario("enable disable persists and reloads", async ({ service, store, runtime }) => {
  addPlugin(store, { enabled: false });
  const result = await service.setEnabled("plug", true);
  assert.equal(result.ok, true);
  assert.equal(store.getRecord("plug")?.enabled, true);
  assert.deepEqual(runtime.reloads, ["plug"]);
});

await scenario("reload unknown is safe error", async ({ service }) => {
  const result = await service.reload("missing");
  assert.equal(result.ok, false);
  assert.match(result.error, /not installed/);
});

await scenario("stop cancels runtime", async ({ service, runtime }) => {
  service.stop();
  assert.equal(runtime.stopped, true);
});

await localScenario("loadLocal snapshots manifest disabled", async ({ service, store, source }) => {
  writeManifest(source, manifest({ id: "local-plug", permissions: ["timer", "pet:speak"] }));
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  const record = store.getRecord("local-plug");
  assert.equal(record?.enabled, false);
  assert.equal(record?.source, "local");
  assert.deepEqual(record?.approvedPermissions, ["pet:speak", "timer"]);
  assert.equal(existsSync(join(record?.installPath ?? "", OPENPETS_PLUGIN_MANIFEST_FILENAME)), true);
  assert.equal("installPath" in result.snapshot.plugins[0], false);
});

await localScenario("loadLocal picker cancel does not install", async ({ service, store }) => {
  service["__cancelPicker"] = true;
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  assert.deepEqual(store.listRecords(), []);
});

await localScenario("loadLocal permission cancel does not install", async ({ service, store, source }) => {
  writeManifest(source, manifest({ id: "cancel-plug" }));
  service["__denyPermissions"] = true;
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  assert.deepEqual(store.listRecords(), []);
  assert.equal(existsSync(join(service["__userData"] as string, "plugins-dev", "cancel-plug", OPENPETS_PLUGIN_MANIFEST_FILENAME)), false);
});

await localScenario("loadLocal permission cancel preserves previous snapshot", async ({ service, store, source, userData }) => {
  writeManifest(source, manifest({ id: "keep-plug", version: "2.0.0", permissions: ["timer", "pet:speak", "pet:reaction"], triggers: [{ on: "timer", everyMinutes: 5, actions: [{ type: "pet.react", reaction: "celebrating" }] }] }));
  const install = join(userData, "plugins-dev", "keep-plug");
  const oldManifestPath = writeManifest(install, manifest({ id: "keep-plug", version: "1.0.0", permissions: ["timer", "pet:speak"] }));
  store.upsertRecord({ id: "keep-plug", version: "1.0.0", installPath: install, manifestPath: oldManifestPath, source: "local", enabled: true, approvedPermissions: ["timer", "pet:speak"], config: {} });
  service["__denyPermissions"] = true;
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  assert.equal(store.getRecord("keep-plug")?.version, "1.0.0");
  assert.equal(JSON.parse(readFileSync(oldManifestPath, "utf8")).version, "1.0.0");
});

await localScenario("loadLocal rejects invalid manifest safely", async ({ service, source, root }) => {
  writeManifest(source, { bad: true });
  const result = await service.loadLocal();
  assert.equal(result.ok, false);
  assert.equal(result.error.includes(root), false);
  assert.equal(result.error, "Plugin manifest validation failed.");
});

await localScenario("loadLocal rejects source symlink", async ({ service, source, root }) => {
  writeManifest(source, manifest({ id: "symlink-folder" }));
  const link = join(root, "source-link");
  symlinkSync(source, link, "dir");
  service["__source"] = link;
  const result = await service.loadLocal();
  assert.equal(result.ok, false);
});

await localScenario("loadLocal rejects manifest symlink", async ({ service, source, root }) => {
  const real = join(root, "real-manifest.json");
  writeFileSync(real, JSON.stringify(manifest({ id: "symlink-manifest" })), "utf8");
  symlinkSync(real, join(source, OPENPETS_PLUGIN_MANIFEST_FILENAME));
  const result = await service.loadLocal();
  assert.equal(result.ok, false);
});

await localScenario("loadLocal reload preserves enabled for subset permissions", async ({ service, store, runtime, source, userData }) => {
  writeManifest(source, manifest({ id: "reload-plug", version: "2.0.0", permissions: ["timer", "pet:speak"] }));
  const existingInstall = join(userData, "plugins-dev", "reload-plug");
  const existingManifest = writeManifest(existingInstall, manifest({ id: "reload-plug", permissions: ["timer", "pet:speak"] }));
  store.upsertRecord({ id: "reload-plug", version: "1.0.0", installPath: existingInstall, manifestPath: existingManifest, source: "local", enabled: true, approvedPermissions: ["timer", "pet:speak"], config: {} });
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  assert.equal(store.getRecord("reload-plug")?.enabled, true);
  assert.equal(store.getRecord("reload-plug")?.version, "2.0.0");
  assert.deepEqual(runtime.reloads, ["reload-plug"]);
});

await localScenario("loadLocal rejects catalog collision", async ({ service, store, source, userData }) => {
  writeManifest(source, manifest({ id: "catalog-plug" }));
  const install = join(userData, "plugins", "catalog-plug");
  const manifestPath = writeManifest(install, manifest({ id: "catalog-plug" }));
  store.upsertRecord({ id: "catalog-plug", version: "1.0.0", installPath: install, manifestPath, source: "catalog", enabled: false, approvedPermissions: ["timer", "pet:speak"], config: {} });
  const result = await service.loadLocal();
  assert.equal(result.ok, false);
  assert.match(result.error, /catalog plugin/);
  assert.equal(existsSync(join(userData, "plugins-dev", "catalog-plug", OPENPETS_PLUGIN_MANIFEST_FILENAME)), false);
});

await localScenario("loadLocal rejects destination symlink before write", async ({ service, source, userData, root }) => {
  writeManifest(source, manifest({ id: "dest-link" }));
  const outside = join(root, "outside-target");
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(userData, "plugins-dev", "dest-link"), "dir");
  const result = await service.loadLocal();
  assert.equal(result.ok, false);
  assert.equal(existsSync(join(outside, OPENPETS_PLUGIN_MANIFEST_FILENAME)), false);
});

await localScenario("loadLocal permission change disables", async ({ service, store, source, userData }) => {
  writeManifest(source, manifest({ id: "perm-plug", permissions: ["timer", "pet:speak", "pet:reaction"], triggers: [{ on: "timer", everyMinutes: 5, actions: [{ type: "pet.react", reaction: "celebrate" }] }] }));
  const install = join(userData, "plugins-dev", "perm-plug");
  const manifestPath = writeManifest(install, manifest({ id: "perm-plug", permissions: ["timer", "pet:speak"] }));
  store.upsertRecord({ id: "perm-plug", version: "1.0.0", installPath: install, manifestPath, source: "local", enabled: true, approvedPermissions: ["timer", "pet:speak"], config: {} });
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  assert.equal(store.getRecord("perm-plug")?.enabled, false);
  assert.deepEqual(store.getRecord("perm-plug")?.approvedPermissions, ["pet:speak", "pet:reaction", "timer"]);
  assert.deepEqual(service["__runtimeReloads"], ["perm-plug"]);
});

await localScenario("loadLocal uses real source path", async ({ service, source }) => {
  writeManifest(source, manifest({ id: "realpath-plug" }));
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.plugins[0].id, "realpath-plug");
});

await localScenario("loadLocal copies only manifest", async ({ service, source, store, userData }) => {
  writeManifest(source, manifest({ id: "only-manifest" }));
  writeFileSync(join(source, "extra.txt"), "extra", "utf8");
  const result = await service.loadLocal();
  assert.equal(result.ok, true);
  const install = store.getRecord("only-manifest")?.installPath ?? join(userData, "plugins-dev", "only-manifest");
  assert.equal(existsSync(join(install, OPENPETS_PLUGIN_MANIFEST_FILENAME)), true);
  assert.equal(existsSync(join(install, "extra.txt")), false);
});

await localScenario("uninstall removes state reloads and rejects symlink deletion", async ({ service, store, runtime, userData, root }) => {
  const install = join(userData, "plugins", "remove-plug");
  const manifestPath = writeManifest(install, manifest({ id: "remove-plug" }));
  store.upsertRecord({ id: "remove-plug", version: "1.0.0", installPath: install, manifestPath, source: "catalog", enabled: true, approvedPermissions: ["timer", "pet:speak"], config: {} });
  const result = await service.uninstall("remove-plug");
  assert.equal(result.ok, true);
  assert.equal(store.getRecord("remove-plug"), undefined);
  assert.deepEqual(runtime.reloads, ["remove-plug"]);

  const outside = join(root, "outside-remove");
  mkdirSync(outside, { recursive: true });
  const link = join(userData, "plugins", "link-plug");
  symlinkSync(outside, link, "dir");
  store.upsertRecord({ id: "link-plug", version: "1.0.0", installPath: link, manifestPath: join(link, OPENPETS_PLUGIN_MANIFEST_FILENAME), source: "catalog", enabled: true, approvedPermissions: ["timer", "pet:speak"], config: {} });
  const rejected = await service.uninstall("link-plug");
  assert.equal(rejected.ok, false);
  assert.equal(store.getRecord("link-plug")?.id, "link-plug");
  assert.equal(existsSync(outside), true);

  const rootOutside = join(root, "outside-root");
  mkdirSync(rootOutside, { recursive: true });
  rmSync(join(userData, "plugins"), { recursive: true, force: true });
  symlinkSync(rootOutside, join(userData, "plugins"), "dir");
  store.upsertRecord({ id: "root-link", version: "1.0.0", installPath: join(userData, "plugins", "root-link"), manifestPath: join(userData, "plugins", "root-link", OPENPETS_PLUGIN_MANIFEST_FILENAME), source: "catalog", enabled: true, approvedPermissions: ["timer", "pet:speak"], config: {} });
  const rootRejected = await service.uninstall("root-link");
  assert.equal(rootRejected.ok, false);
  assert.equal(store.getRecord("root-link")?.id, "root-link");
});

await catalogRollbackScenario("catalog update rolls back manifest if state write fails", async ({ service, store, runtime, userData }) => {
  const oldManifest = manifest({ id: "rollback-plug", version: "1.0.0" });
  const install = join(userData, "plugins", "rollback-plug");
  const manifestPath = writeManifest(install, oldManifest);
  store.upsertRecord({ id: "rollback-plug", version: "1.0.0", installPath: install, manifestPath, source: "catalog", enabled: true, approvedPermissions: ["timer", "pet:speak"], config: {} });

  store.failNextUpsert = true;
  const result = await service.updateCatalog("rollback-plug");
  assert.equal(result.ok, false);
  assert.equal(store.getRecord("rollback-plug")?.version, "1.0.0");
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).version, "1.0.0");
  assert.deepEqual(runtime.reloads, []);
});

console.error("Plugin service validation passed.");

async function scenario(name: string, fn: (ctx: { root: string; userData: string; store: PluginStateStore; service: PluginService; runtime: FakeRuntime }) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "openpets-plugin-service-root-"));
  lastRoot = root;
  const userData = mkdtempSync(join(tmpdir(), "openpets-plugin-service-user-"));
  const store = new PluginStateStore({ statePath: join(userData, "state.json") });
  store.initialize();
  const runtime = new FakeRuntime();
  const service = new PluginService({ stateStore: store, runtime: runtime as never, allowedPluginRoots: [root] });
  try { await fn({ root, userData, store, service, runtime }); } catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function localScenario(name: string, fn: (ctx: { root: string; userData: string; source: string; store: PluginStateStore; service: PluginService & Record<string, unknown>; runtime: FakeRuntime }) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "openpets-plugin-local-root-"));
  const userData = mkdtempSync(join(tmpdir(), "openpets-plugin-local-user-"));
  const source = join(root, "source");
  mkdirSync(source, { recursive: true });
  mkdirSync(join(userData, "plugins"), { recursive: true });
  mkdirSync(join(userData, "plugins-dev"), { recursive: true });
  const store = new PluginStateStore({ statePath: join(userData, "state.json") });
  store.initialize();
  const runtime = new FakeRuntime();
  let service: PluginService & Record<string, unknown>;
  service = new PluginService({ userDataPath: userData, stateStore: store, runtime: runtime as never, showOpenDialog: async () => service["__cancelPicker"] ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [String(service["__source"] ?? source)] }, confirmPermissions: async () => !service["__denyPermissions"] }) as PluginService & Record<string, unknown>;
  service["__userData"] = userData;
  service["__runtimeReloads"] = runtime.reloads;
  try { await fn({ root, userData, source, store, service, runtime }); } catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function catalogRollbackScenario(name: string, fn: (ctx: { root: string; userData: string; store: ThrowingStateStore; service: PluginService; runtime: FakeRuntime }) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "openpets-plugin-catalog-root-"));
  const userData = mkdtempSync(join(tmpdir(), "openpets-plugin-catalog-user-"));
  mkdirSync(join(userData, "plugins"), { recursive: true });
  mkdirSync(join(userData, "plugins-dev"), { recursive: true });
  const store = new ThrowingStateStore({ statePath: join(userData, "state.json") });
  store.initialize();
  const runtime = new FakeRuntime();
  const nextManifest = manifest({ id: "rollback-plug", version: "2.0.0" });
  const zip = makeZip(OPENPETS_PLUGIN_MANIFEST_FILENAME, Buffer.from(JSON.stringify(nextManifest), "utf8"));
  const downloadUrl = "https://zip.openpets.dev/plugins/rollback-plug.zip";
  const catalog = { version: 1, generatedAt: new Date().toISOString(), plugins: [{ id: nextManifest.id, name: nextManifest.name, version: nextManifest.version, description: "Rollback", runtime: "declarative", permissions: nextManifest.permissions, downloadUrl, sha256: createHash("sha256").update(zip).digest("hex") }] };
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    const value = String(url);
    if (value === downloadUrl) return new Response(new Uint8Array(zip), { status: 200 });
    return new Response(JSON.stringify(catalog), { status: 200 });
  };
  const service = new PluginService({ userDataPath: userData, stateStore: store, runtime: runtime as never, fetchImpl, confirmPermissions: async () => true });
  try { await fn({ root, userData, store, service, runtime }); } catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

function addPlugin(store: PluginStateStore, patch: Partial<PluginStateRecord> = {}, data: unknown = manifest()): void {
  const id = patch.id ?? "plug";
  const installPath = patch.installPath ?? join(currentRootFromStore(store), id);
  const manifestPath = patch.manifestPath ?? writeManifest(installPath, data);
  store.upsertRecord({ id, version: patch.version ?? "1.0.0", manifestPath, installPath, source: patch.source ?? "local", enabled: patch.enabled ?? true, approvedPermissions: patch.approvedPermissions ?? ["timer", "pet:speak"], config: patch.config ?? {}, brokenReason: patch.brokenReason });
}

function currentRootFromStore(_store: PluginStateStore): string { return lastRoot; }

function manifest(patch: Partial<OpenPetsPluginManifest> & { everyMinutes?: OpenPetsPluginManifest["triggers"][number]["everyMinutes"] } = {}): OpenPetsPluginManifest {
  return { manifestVersion: 1, id: patch.id ?? "plug", name: "Plug", version: patch.version ?? "1.0.0", runtime: "declarative", permissions: patch.permissions ?? ["timer", "pet:speak"], configSchema: patch.configSchema, triggers: patch.triggers ?? [{ on: "timer", everyMinutes: patch.everyMinutes ?? 5, actions: [{ type: "pet.speak", message: "Stretch" }] }] };
}

function writeManifest(dir: string, data: unknown): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, OPENPETS_PLUGIN_MANIFEST_FILENAME);
  writeFileSync(path, JSON.stringify(data), "utf8");
  return path;
}

function makeZip(name: string, data: Buffer): Buffer {
  const nameBuffer = Buffer.from(name); const crc = crc32(data); const now = 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8); local.writeUInt32LE(now, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(now, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  const localPart = Buffer.concat([local, nameBuffer, data]); const centralPart = Buffer.concat([central, nameBuffer]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralPart.length, 12); end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

function crc32(buffer: Buffer): number { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
