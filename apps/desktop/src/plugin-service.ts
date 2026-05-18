import { mkdirSync, promises as fs } from "node:fs";
import { join } from "node:path";

import { getCatalogPlugin, getPluginCatalog, type PluginCatalogOptions } from "./plugin-catalog.js";
import { getEffectivePluginConfig, validatePluginConfigReplacement, type PluginConfigValidationError, type PluginConfig } from "./plugin-config.js";
import { publishLocalPluginSnapshot, readLocalPluginSourceManifest } from "./plugin-local-loader.js";
import { readSafePluginManifest } from "./plugin-manifest-reader.js";
import { type OpenPetsPluginManifest, type PluginPermission } from "./plugin-manifest.js";
import { downloadCatalogPluginZip, installCatalogPluginPackage, readCatalogPluginManifestFromZip, resolveSafePluginInstallDir } from "./plugin-package.js";
import type { PluginPetApi } from "./plugin-pet-api.js";
import { PluginRuntime, type PluginRuntimeScheduler } from "./plugin-runtime.js";
import { PluginStateStore, type PluginSource, type PluginStateRecord } from "./plugin-state.js";

export type SafePluginRecord = {
  readonly id: string;
  readonly name?: string;
  readonly version: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly brokenReason?: string;
  readonly approvedPermissions: readonly PluginPermission[];
  readonly configSchema?: OpenPetsPluginManifest["configSchema"];
  readonly effectiveConfig?: PluginConfig;
  readonly configErrors?: readonly PluginConfigValidationError[];
};

export type PluginServiceSnapshot = { readonly plugins: readonly SafePluginRecord[] };
export type SafeCatalogPluginRecord = { readonly id: string; readonly name: string; readonly version: string; readonly description: string; readonly runtime: "declarative"; readonly permissions: readonly PluginPermission[]; readonly installed: boolean };
export type PluginCatalogSnapshot = { readonly plugins: readonly SafeCatalogPluginRecord[] };
export type PluginServiceResult = { readonly ok: true; readonly snapshot: PluginServiceSnapshot } | { readonly ok: false; readonly error: string; readonly snapshot: PluginServiceSnapshot };
export type PluginFolderDialog = () => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
export type PluginPermissionDialog = (manifest: OpenPetsPluginManifest) => Promise<boolean>;

export type PluginServiceOptions = {
  readonly userDataPath?: string;
  readonly stateStore?: PluginStateStore;
  readonly runtime?: PluginRuntime;
  readonly petApi?: PluginPetApi;
  readonly scheduler?: PluginRuntimeScheduler;
  readonly allowedPluginRoots?: readonly string[];
  readonly maxManifestBytes?: number;
  readonly showOpenDialog?: PluginFolderDialog;
  readonly confirmPermissions?: PluginPermissionDialog;
  readonly catalogOptions?: PluginCatalogOptions;
  readonly fetchImpl?: typeof fetch;
};

export class PluginService {
  readonly stateStore: PluginStateStore;
  readonly runtime: PluginRuntime;
  readonly allowedPluginRoots: readonly string[];
  readonly #maxManifestBytes?: number;
  readonly #userDataPath?: string;
  readonly #showOpenDialog?: PluginFolderDialog;
  readonly #confirmPermissions?: PluginPermissionDialog;
  readonly #catalogOptions?: PluginCatalogOptions;
  readonly #fetchImpl?: typeof fetch;

  constructor(options: PluginServiceOptions) {
    if (!options.stateStore && !options.userDataPath) throw new Error("Plugin service requires userDataPath or stateStore.");
    if (!options.allowedPluginRoots && !options.userDataPath) throw new Error("Plugin service requires allowedPluginRoots when userDataPath is not provided.");
    this.allowedPluginRoots = options.allowedPluginRoots ?? [join(options.userDataPath ?? "", "plugins"), join(options.userDataPath ?? "", "plugins-dev")];
    this.#userDataPath = options.userDataPath;
    this.#showOpenDialog = options.showOpenDialog;
    this.#confirmPermissions = options.confirmPermissions;
    this.#catalogOptions = options.catalogOptions;
    this.#fetchImpl = options.fetchImpl;
    this.stateStore = options.stateStore ?? new PluginStateStore({ userDataPath: options.userDataPath ?? "" });
    if (options.runtime) {
      this.runtime = options.runtime;
    } else {
      if (!options.petApi) throw new Error("Plugin service requires petApi when runtime is not provided.");
      this.runtime = new PluginRuntime({ stateStore: this.stateStore, petApi: options.petApi, scheduler: options.scheduler, allowedPluginRoots: this.allowedPluginRoots, maxManifestBytes: options.maxManifestBytes });
    }
    this.#maxManifestBytes = options.maxManifestBytes;
  }

  async start(): Promise<void> {
    this.#ensureRoots();
    this.stateStore.initialize();
    await this.runtime.start();
  }

  stop(): void {
    this.runtime.stop();
  }

  async getSnapshot(): Promise<PluginServiceSnapshot> {
    const plugins = [] as SafePluginRecord[];
    for (const record of this.stateStore.listRecords()) plugins.push(await this.#safeRecord(record));
    return { plugins };
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginServiceResult> {
    if (!this.stateStore.getRecord(id)) return this.#error("Plugin is not installed.");
    this.stateStore.setEnabled(id, enabled);
    await this.runtime.reloadPlugin(id);
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async saveConfig(id: string, config: unknown): Promise<PluginServiceResult> {
    const record = this.stateStore.getRecord(id);
    if (!record) return this.#error("Plugin is not installed.");
    let manifest: OpenPetsPluginManifest;
    try {
      manifest = await this.#readManifest(record);
    } catch {
      return this.#error("Plugin manifest is unavailable.");
    }
    const result = validatePluginConfigReplacement(manifest, config);
    if (!result.ok) return this.#error("Plugin config is invalid.");
    this.stateStore.replaceConfig(id, result.config);
    await this.runtime.reloadPlugin(id);
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async reload(id: string): Promise<PluginServiceResult> {
    if (!this.stateStore.getRecord(id)) return this.#error("Plugin is not installed.");
    await this.runtime.reloadPlugin(id);
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async getCatalogSnapshot(refresh = false): Promise<PluginCatalogSnapshot> {
    try {
      const catalog = await getPluginCatalog({ ...this.#catalogOptions, fetchImpl: this.#fetchImpl ?? this.#catalogOptions?.fetchImpl, refresh });
      return { plugins: catalog.plugins.map((entry) => ({ id: entry.id, name: entry.name, version: entry.version, description: entry.description, runtime: entry.runtime, permissions: entry.permissions, installed: this.stateStore.getRecord(entry.id)?.source === "catalog" })) };
    } catch {
      return { plugins: [] };
    }
  }

  async installCatalog(id: string): Promise<PluginServiceResult> {
    return this.#installOrUpdateCatalog(id, false);
  }

  async updateCatalog(id: string): Promise<PluginServiceResult> {
    return this.#installOrUpdateCatalog(id, true);
  }

  async uninstall(id: string): Promise<PluginServiceResult> {
    if (!this.#userDataPath) return this.#error("Plugin uninstall is unavailable.");
    const record = this.stateStore.getRecord(id);
    if (!record) return this.#error("Plugin is not installed.");
    let realInstall: string;
    try { realInstall = await resolveSafePluginInstallDir(this.#userDataPath, id, record.installPath, record.source); }
    catch (error) { return this.#error(safeError(error)); }
    this.stateStore.removeRecord(id);
    await this.runtime.reloadPlugin(id);
    try { await fs.rm(realInstall, { recursive: true, force: true }); }
    catch (error) { return this.#error(safeError(error)); }
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async loadLocal(): Promise<PluginServiceResult> {
    if (!this.#userDataPath) return this.#error("Local plugin loading is unavailable.");
    const picker = this.#showOpenDialog ?? defaultOpenDialog;
    const confirm = this.#confirmPermissions ?? defaultConfirmPermissions;
    const selection = await picker();
    if (selection.canceled || selection.filePaths.length === 0) return { ok: true, snapshot: await this.getSnapshot() };
    let source: Awaited<ReturnType<typeof readLocalPluginSourceManifest>>;
    try {
      source = await readLocalPluginSourceManifest({ sourceFolder: selection.filePaths[0] ?? "", maxManifestBytes: this.#maxManifestBytes });
    } catch (error) {
      return this.#error(safeError(error));
    }
    const existing = this.stateStore.getRecord(source.manifest.id);
    if (existing?.source === "catalog") return this.#error("A catalog plugin with this id is already installed.");
    const permissionsChanged = existing ? !isPermissionSubset(source.manifest.permissions, existing.approvedPermissions) : true;
    if (permissionsChanged) {
      const approved = await confirm(source.manifest);
      if (!approved) return { ok: true, snapshot: await this.getSnapshot() };
    }
    let loaded: Awaited<ReturnType<typeof publishLocalPluginSnapshot>>;
    try {
      loaded = await publishLocalPluginSnapshot({ manifest: source.manifest, manifestText: source.manifestText, userDataPath: this.#userDataPath, maxManifestBytes: this.#maxManifestBytes });
    } catch (error) {
      return this.#error(safeError(error));
    }
    const wasEnabled = existing?.enabled === true;
    const enabled = existing && !permissionsChanged ? existing.enabled : false;
    this.stateStore.upsertRecord({
      id: loaded.manifest.id,
      version: loaded.manifest.version,
      source: "local",
      installPath: loaded.installPath,
      manifestPath: loaded.manifestPath,
      enabled,
      approvedPermissions: loaded.manifest.permissions,
      config: existing?.config ?? {},
    });
    if (enabled || wasEnabled) await this.runtime.reloadPlugin(loaded.manifest.id);
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async #installOrUpdateCatalog(id: string, update: boolean): Promise<PluginServiceResult> {
    if (!this.#userDataPath) return this.#error("Catalog plugin installation is unavailable.");
    const existing = this.stateStore.getRecord(id);
    if (!update && existing) return this.#error("Plugin is already installed.");
    if (update && (!existing || existing.source !== "catalog")) return this.#error("Catalog plugin is not installed.");
    if (existing?.source === "local") return this.#error("A local plugin with this id is already loaded.");
    const confirm = this.#confirmPermissions ?? defaultConfirmPermissions;
    try {
      const entry = await getCatalogPlugin(id, { ...this.#catalogOptions, fetchImpl: this.#fetchImpl ?? this.#catalogOptions?.fetchImpl, refresh: update });
      const zip = await downloadCatalogPluginZip(entry, this.#fetchImpl ?? this.#catalogOptions?.fetchImpl ?? fetch);
      const preview = await readCatalogPluginManifestFromZip({ catalogEntry: entry, zip, maxManifestBytes: this.#maxManifestBytes });
      const permissionsChanged = existing ? !isPermissionSubset(preview.manifest.permissions, existing.approvedPermissions) : true;
      if (permissionsChanged && !(await confirm(preview.manifest))) return { ok: true, snapshot: await this.getSnapshot() };
      const previousManifestText = existing ? await fs.readFile(existing.manifestPath, "utf8").catch(() => undefined) : undefined;
      const loaded = await installCatalogPluginPackage({ userDataPath: this.#userDataPath, catalogEntry: entry, zip, maxManifestBytes: this.#maxManifestBytes });
      const wasEnabled = existing?.enabled === true;
      try {
        this.stateStore.upsertRecord({ id: loaded.manifest.id, version: loaded.manifest.version, source: "catalog", installPath: loaded.installPath, manifestPath: loaded.manifestPath, enabled: existing && !permissionsChanged ? existing.enabled : false, approvedPermissions: loaded.manifest.permissions, config: existing?.config ?? {} });
      } catch (error) {
        if (previousManifestText !== undefined) await fs.writeFile(loaded.manifestPath, previousManifestText, { mode: 0o600 }).catch(() => undefined);
        else await fs.rm(loaded.installPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      if (wasEnabled || (existing && !permissionsChanged && existing.enabled)) await this.runtime.reloadPlugin(id);
      return { ok: true, snapshot: await this.getSnapshot() };
    } catch (error) { return this.#error(safeError(error)); }
  }

  async #safeRecord(record: PluginStateRecord): Promise<SafePluginRecord> {
    const base = { id: record.id, version: record.version, source: record.source, enabled: record.enabled, brokenReason: record.brokenReason, approvedPermissions: record.approvedPermissions };
    try {
      const manifest = await this.#readManifest(record);
      const config = getEffectivePluginConfig(manifest, record.config);
      return { ...base, brokenReason: sanitizePluginUiMessage(record.brokenReason), name: manifest.name, configSchema: manifest.configSchema, effectiveConfig: config.ok ? config.config : undefined, configErrors: config.ok ? undefined : config.errors };
    } catch (error) {
      return { ...base, brokenReason: sanitizePluginUiMessage(record.brokenReason) ?? safeError(error) };
    }
  }

  #readManifest(record: PluginStateRecord): Promise<OpenPetsPluginManifest> {
    return readSafePluginManifest({ installPath: record.installPath, manifestPath: record.manifestPath, allowedPluginRoots: this.allowedPluginRoots, maxManifestBytes: this.#maxManifestBytes, expectedId: record.id, expectedVersion: record.version });
  }

  async #error(error: string): Promise<PluginServiceResult> {
    return { ok: false, error, snapshot: await this.getSnapshot() };
  }

  #ensureRoots(): void {
    for (const root of this.allowedPluginRoots) mkdirSync(root, { recursive: true });
  }
}

let appPluginService: PluginService | null = null;

export function initializePluginService(userDataPath: string, petApi: PluginPetApi): PluginService {
  appPluginService = new PluginService({ userDataPath, petApi });
  return appPluginService;
}

export function stopPluginService(): void {
  appPluginService?.stop();
}

export function getPluginService(): PluginService {
  if (!appPluginService) throw new Error("Plugin service is not initialized.");
  return appPluginService;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Plugin manifest is unavailable.";
  if (/manifest validation failed/i.test(message)) return "Plugin manifest validation failed.";
  if (/too large/i.test(message)) return "Plugin manifest is too large.";
  if (/outside allowed/i.test(message)) return "Plugin install path is outside allowed plugin roots.";
  if (/outside install/i.test(message)) return "Plugin manifest path is outside install path.";
  if (/path is invalid/i.test(message)) return "Plugin manifest path is invalid.";
  if (/id\/version/i.test(message)) return "Plugin manifest id/version does not match installed state.";
  return "Plugin manifest is unavailable.";
}

function sanitizePluginUiMessage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (looksPathLike(value)) return "Plugin needs attention. Check logs for details.";
  return value;
}

function looksPathLike(value: string): boolean {
  return /(?:[A-Za-z]:\\|\/[^\s]+|\\[^\s]+|file:\/\/|ENOENT|EACCES|EPERM)/.test(value);
}

function isPermissionSubset(next: readonly PluginPermission[], approved: readonly PluginPermission[]): boolean {
  const approvedSet = new Set(approved);
  return next.every((permission) => approvedSet.has(permission));
}

async function defaultOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
  const { dialog } = await import("electron");
  return dialog.showOpenDialog({ properties: ["openDirectory"] });
}

async function defaultConfirmPermissions(manifest: OpenPetsPluginManifest): Promise<boolean> {
  const { dialog } = await import("electron");
  const permissions = manifest.permissions.length === 0 ? "No permissions" : manifest.permissions.join(", ");
  const result = await dialog.showMessageBox({ type: "question", buttons: ["Load plugin", "Cancel"], defaultId: 0, cancelId: 1, title: "Load local OpenPets plugin?", message: `Load ${manifest.name}?`, detail: `Permissions: ${permissions}` });
  return result.response === 0;
}
