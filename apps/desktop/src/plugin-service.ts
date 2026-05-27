import { existsSync, mkdirSync, promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { getCatalogPlugin, getPluginCatalog, type PluginCatalogOptions } from "./plugin-catalog.js";
import type { PluginCatalogEntryV2 } from "./plugin-catalog-validation.js";
import { getEffectivePluginConfig, validatePluginConfigReplacement, type PluginConfigValidationError, type PluginConfig } from "./plugin-config.js";
import { publishLocalPluginSnapshot, readLocalPluginSourceManifest } from "./plugin-local-loader.js";
import { readSafePluginManifest } from "./plugin-manifest-reader.js";
import type { PluginJsHost } from "./plugin-js-host.js";
import { OPENPETS_PLUGIN_MANIFEST_FILENAME, type OpenPetsPluginManifest, type PluginIcon, type PluginPermission } from "./plugin-manifest.js";
import { downloadCatalogPluginZip, installCatalogPluginPackage, readCatalogPluginManifestFromZip, resolveSafePluginInstallDir } from "./plugin-package.js";
import type { PluginPetApi } from "./plugin-pet-api.js";
import { JsonPluginStorageStore, type PluginCommand, type PluginLogLevel, type PluginStatus } from "./plugin-sdk-bridge.js";
import { PluginRuntime, type PluginRuntimeScheduler } from "./plugin-runtime.js";
import { PluginStateStore, type PluginSource, type PluginStateRecord } from "./plugin-state.js";

export type SafePluginRecord = {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly version: string;
  readonly icon?: PluginIcon;
  readonly source: PluginSource;
  readonly bundled?: boolean;
  readonly enabled: boolean;
  readonly brokenReason?: string;
  readonly approvedPermissions: readonly PluginPermission[];
  readonly runtime?: "declarative" | "javascript";
  readonly sdkVersion?: string;
  readonly catalogDisabled?: boolean;
  readonly catalogDeprecated?: boolean;
  readonly catalogStatusReason?: string;
  readonly configSchema?: OpenPetsPluginManifest["configSchema"];
  readonly effectiveConfig?: PluginConfig;
  readonly configErrors?: readonly PluginConfigValidationError[];
  readonly commands?: readonly PluginCommand[];
  readonly status?: PluginStatus;
};

export type PluginServiceSnapshot = { readonly plugins: readonly SafePluginRecord[] };
export type SafeCatalogPluginRecord = { readonly id: string; readonly name: string; readonly version: string; readonly description: string; readonly runtime: "declarative" | "javascript"; readonly icon?: PluginIcon; readonly sdkVersion?: string; readonly permissions: readonly PluginPermission[]; readonly installed: boolean; readonly bundled?: boolean; readonly deprecated?: boolean; readonly statusReason?: string };
export type PluginCatalogSnapshot = { readonly plugins: readonly SafeCatalogPluginRecord[] };
export type PluginServiceResult = { readonly ok: true; readonly snapshot: PluginServiceSnapshot } | { readonly ok: false; readonly error: string; readonly snapshot: PluginServiceSnapshot };
export type DevPluginLoadResult = { readonly path: string; readonly id?: string; readonly ok: true } | { readonly path: string; readonly ok: false; readonly error: string };
export type PluginFolderDialog = () => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
export type PluginPermissionDialog = (manifest: OpenPetsPluginManifest) => Promise<boolean>;

export type PluginServiceOptions = {
  readonly userDataPath?: string;
  readonly stateStore?: PluginStateStore;
  readonly runtime?: PluginRuntime;
  readonly petApi?: PluginPetApi;
  readonly scheduler?: PluginRuntimeScheduler;
  readonly jsHost?: PluginJsHost;
  readonly allowedPluginRoots?: readonly string[];
  readonly maxManifestBytes?: number;
  readonly showOpenDialog?: PluginFolderDialog;
  readonly confirmPermissions?: PluginPermissionDialog;
  readonly catalogOptions?: PluginCatalogOptions;
  readonly fetchImpl?: typeof fetch;
  readonly currentAppVersion?: string;
  readonly runtimeLogger?: (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => void;
  readonly disableCatalog?: boolean;
  readonly seedBundledPlugins?: boolean;
  readonly bundledPluginSourceDirs?: readonly string[];
};

export const bundledOfficialPluginIds = ["openpets.ambient-companion", "openpets.break-buddy", "openpets.pet-pal", "openpets.focus-buddy", "openpets.wander-buddy", "openpets.github-notifications"] as const;
const bundledEnabledByDefault = new Set<string>(["openpets.ambient-companion", "openpets.break-buddy", "openpets.pet-pal", "openpets.focus-buddy", "openpets.wander-buddy"]);
const staleBundledPluginIds = ["openpets.daily-reminders", "openpets.pomodoro"] as const;

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
  readonly #currentAppVersion: string;
  readonly #disableCatalog: boolean;
  readonly #seedBundledPlugins: boolean;
  readonly #bundledPluginSourceDirs: readonly string[];

  constructor(options: PluginServiceOptions) {
    if (!options.stateStore && !options.userDataPath) throw new Error("Plugin service requires userDataPath or stateStore.");
    if (!options.allowedPluginRoots && !options.userDataPath) throw new Error("Plugin service requires allowedPluginRoots when userDataPath is not provided.");
    this.allowedPluginRoots = options.allowedPluginRoots ?? [join(options.userDataPath ?? "", "plugins"), join(options.userDataPath ?? "", "plugins-dev")];
    this.#userDataPath = options.userDataPath;
    this.#showOpenDialog = options.showOpenDialog;
    this.#confirmPermissions = options.confirmPermissions;
    this.#catalogOptions = options.catalogOptions;
    this.#fetchImpl = options.fetchImpl;
    this.#currentAppVersion = options.currentAppVersion ?? "0.0.0";
    this.#disableCatalog = options.disableCatalog === true;
    this.#seedBundledPlugins = options.seedBundledPlugins !== false;
    this.#bundledPluginSourceDirs = options.bundledPluginSourceDirs ?? [];
    this.stateStore = options.stateStore ?? new PluginStateStore({ userDataPath: options.userDataPath ?? "" });
    if (options.runtime) {
      this.runtime = options.runtime;
    } else {
      if (!options.petApi) throw new Error("Plugin service requires petApi when runtime is not provided.");
      this.runtime = new PluginRuntime({ stateStore: this.stateStore, petApi: options.petApi, scheduler: options.scheduler, allowedPluginRoots: this.allowedPluginRoots, maxManifestBytes: options.maxManifestBytes, jsHost: options.jsHost, storageStore: options.userDataPath ? new JsonPluginStorageStore(join(options.userDataPath, "plugin-storage")) : undefined, logger: options.runtimeLogger });
    }
    this.#maxManifestBytes = options.maxManifestBytes;
  }

  async start(): Promise<void> {
    this.#ensureRoots();
    this.stateStore.initialize();
    if (this.#seedBundledPlugins) await this.seedBundledPlugins();
    await this.runtime.start();
  }

  async seedBundledPlugins(): Promise<void> {
    if (!this.#userDataPath) return;
    for (const id of staleBundledPluginIds) {
      const stale = this.stateStore.getRecord(id);
      if (stale?.source === "catalog" || stale?.source === "local") {
        try {
          const safeInstall = await resolveSafePluginInstallDir(this.#userDataPath, id, stale.installPath, stale.source);
          this.stateStore.removeRecord(id);
          await fs.rm(safeInstall, { recursive: true, force: true });
        } catch (error) {
          this.#log("warn", "Refused to prune stale bundled plugin.", { pluginId: id, reason: safeError(error) });
        }
      }
    }
    for (const id of bundledOfficialPluginIds) {
      const sourceFolder = this.#findBundledSourceFolder(id);
      if (!sourceFolder) continue;
      try { await this.#seedBundledPluginFromSource(sourceFolder, id); }
      catch (error) { this.#log("warn", "Bundled plugin seed failed.", { pluginId: id, reason: safeError(error) }); }
    }
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
    const record = this.stateStore.getRecord(id);
    if (!record) return this.#error("Plugin is not installed.");
    if (enabled && record.catalogDisabled) return this.#error("Plugin is disabled in the catalog.");
    if (enabled && record.brokenReason) return this.#error(record.brokenReason);
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
    const record = this.stateStore.getRecord(id);
    if (!record) return this.#error("Plugin is not installed.");
    if (record.catalogDisabled) return this.#error("Plugin is disabled in the catalog.");
    await this.runtime.reloadPlugin(id);
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async executeCommand(id: string, commandId: string): Promise<PluginServiceResult> {
    const record = this.stateStore.getRecord(id);
    if (!record) return this.#error("Plugin is not installed.");
    try { await this.runtime.executeCommand(id, commandId); }
    catch (error) { return this.#error(safeError(error)); }
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async getCatalogSnapshot(refresh = false): Promise<PluginCatalogSnapshot> {
    if (this.#disableCatalog) return { plugins: [] };
    try {
      const catalog = await getPluginCatalog({ ...this.#catalogOptions, fetchImpl: this.#fetchImpl ?? this.#catalogOptions?.fetchImpl, refresh });
      for (const entry of catalog.plugins) await this.#updateCatalogMetadata(entry);
      return { plugins: catalog.plugins.filter((entry) => !isEntryDisabled(entry) && isCatalogEntryCompatible(entry.minOpenPetsVersion, getMaxVersion(entry), this.#currentAppVersion)).map((entry) => { const installed = this.stateStore.getRecord(entry.id); return { id: entry.id, name: entry.name, version: entry.version, description: entry.description, runtime: entry.runtime, icon: entry.icon, sdkVersion: getSdkVersion(entry), permissions: entry.permissions, installed: installed?.source === "catalog", bundled: installed?.bundled || undefined, deprecated: isEntryDeprecated(entry) || undefined, statusReason: getStatusReason(entry) }; }) };
    } catch {
      return { plugins: [] };
    }
  }

  async installCatalog(id: string): Promise<PluginServiceResult> {
    return this.#installOrUpdateCatalog(id, false);
  }

  async updateCatalog(id: string): Promise<PluginServiceResult> {
    const record = this.stateStore.getRecord(id);
    if (record?.bundled) return this.#error("Bundled plugins update with OpenPets.");
    return this.#installOrUpdateCatalog(id, true);
  }

  async uninstall(id: string): Promise<PluginServiceResult> {
    if (!this.#userDataPath) return this.#error("Plugin uninstall is unavailable.");
    const record = this.stateStore.getRecord(id);
    if (!record) return this.#error("Plugin is not installed.");
    if (record.bundled) return this.#error("Bundled plugins cannot be uninstalled. Disable the plugin instead.");
    let realInstall: string;
    try { realInstall = await resolveSafePluginInstallDir(this.#userDataPath, id, record.installPath, record.source); }
    catch (error) { return this.#error(safeError(error)); }
    this.stateStore.removeRecord(id);
    await this.runtime.reloadPlugin(id);
    try { await fs.rm(realInstall, { recursive: true, force: true }); await fs.rm(join(this.#userDataPath, "plugin-storage", `${id}.json`), { force: true }); }
    catch (error) { return this.#error(safeError(error)); }
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async loadLocal(): Promise<PluginServiceResult> {
    if (!this.#userDataPath) return this.#error("Local plugin loading is unavailable.");
    const picker = this.#showOpenDialog ?? defaultOpenDialog;
    const selection = await picker();
    if (selection.canceled || selection.filePaths.length === 0) return { ok: true, snapshot: await this.getSnapshot() };
    return this.loadLocalPath(selection.filePaths[0] ?? "", { autoApprove: false });
  }

  async loadLocalPath(sourceFolder: string, options: { readonly autoApprove?: boolean } = {}): Promise<PluginServiceResult> {
    if (!this.#userDataPath) return this.#error("Local plugin loading is unavailable.");
    const confirm = this.#confirmPermissions ?? defaultConfirmPermissions;
    let source: Awaited<ReturnType<typeof readLocalPluginSourceManifest>>;
    try {
      source = await readLocalPluginSourceManifest({ sourceFolder, maxManifestBytes: this.#maxManifestBytes });
    } catch (error) {
      return this.#error(safeError(error));
    }
    const existing = this.stateStore.getRecord(source.manifest.id);
    if (existing?.source === "catalog") return this.#error("A catalog plugin with this id is already installed.");
    const networkHosts = "network" in source.manifest ? source.manifest.network?.hosts : undefined;
    const approvalsChanged = existing ? !isPermissionSubset(source.manifest.permissions, existing.approvedPermissions) || !isStringSubset(networkHosts ?? [], existing.approvedNetworkHosts ?? []) : true;
    if (approvalsChanged) {
      const approved = options.autoApprove === true || await confirm(source.manifest);
      if (!approved) return { ok: true, snapshot: await this.getSnapshot() };
    }
    let loaded: Awaited<ReturnType<typeof publishLocalPluginSnapshot>>;
    try {
      loaded = await publishLocalPluginSnapshot({ manifest: source.manifest, manifestText: source.manifestText, entryText: source.entryText, userDataPath: this.#userDataPath, maxManifestBytes: this.#maxManifestBytes });
    } catch (error) {
      return this.#error(safeError(error));
    }
    const wasEnabled = existing?.enabled === true;
    const enabled = existing && !approvalsChanged ? existing.enabled : false;
    this.stateStore.upsertRecord({
      id: loaded.manifest.id,
      version: loaded.manifest.version,
      source: "local",
      installPath: loaded.installPath,
      manifestPath: loaded.manifestPath,
      manifestVersion: loaded.manifest.manifestVersion,
      runtime: loaded.manifest.runtime,
      sdkVersion: "sdkVersion" in loaded.manifest ? loaded.manifest.sdkVersion : undefined,
      enabled,
      approvedPermissions: loaded.manifest.permissions,
      approvedNetworkHosts: networkHosts,
      config: existing?.config ?? {},
    });
    if (enabled || wasEnabled) await this.runtime.reloadPlugin(loaded.manifest.id);
    return { ok: true, snapshot: await this.getSnapshot() };
  }

  async loadLocalRoots(rootPaths: readonly string[], options: { readonly autoApprove?: boolean; readonly pruneStale?: boolean } = {}): Promise<readonly DevPluginLoadResult[]> {
    const results: DevPluginLoadResult[] = [];
    const activeIds = new Set<string>();
    let scannedRoot = false;
    for (const rootPath of rootPaths) {
      let entries: string[] = [];
      try {
        const root = await fs.realpath(rootPath);
        const dirents = await fs.readdir(root, { withFileTypes: true });
        scannedRoot = true;
        entries = dirents.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => join(root, entry.name)).sort((a, b) => a.localeCompare(b));
      } catch (error) {
        results.push({ path: rootPath, ok: false, error: safeError(error) });
        continue;
      }
      for (const path of entries) {
        try { await fs.access(join(path, OPENPETS_PLUGIN_MANIFEST_FILENAME)); }
        catch { continue; }
        let id: string | undefined;
        try { id = (await readLocalPluginSourceManifest({ sourceFolder: path, maxManifestBytes: this.#maxManifestBytes })).manifest.id; }
        catch { /* loadLocalPath will report the validation error below. */ }
        const result = await this.loadLocalPath(path, options);
        if (result.ok) { if (id) activeIds.add(id); results.push({ path, id, ok: true }); }
        else results.push({ path, ok: false, error: result.error });
      }
    }
    if (options.pruneStale === true && scannedRoot) await this.#pruneStaleDevLocalPlugins(activeIds);
    return results;
  }

  async #pruneStaleDevLocalPlugins(activeIds: ReadonlySet<string>): Promise<void> {
    if (!this.#userDataPath) return;
    const devRoot = join(this.#userDataPath, "plugins-dev");
    let realDevRoot: string;
    try { realDevRoot = await fs.realpath(devRoot); }
    catch { return; }
    for (const record of this.stateStore.listRecords()) {
      if (record.source !== "local" || activeIds.has(record.id)) continue;
      let isDevRecord = false;
      try { isDevRecord = isUnderPath(await fs.realpath(record.installPath), realDevRoot); }
      catch { isDevRecord = record.installPath.startsWith(`${devRoot}/`); }
      if (!isDevRecord) continue;
      this.stateStore.removeRecord(record.id);
      await this.runtime.reloadPlugin(record.id);
      await fs.rm(record.installPath, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(join(this.#userDataPath, "plugin-storage", `${record.id}.json`), { force: true }).catch(() => undefined);
    }
  }

  async #installOrUpdateCatalog(id: string, update: boolean): Promise<PluginServiceResult> {
    if (!this.#userDataPath) return this.#error("Catalog plugin installation is unavailable.");
    const existing = this.stateStore.getRecord(id);
    if (existing?.bundled) return this.#error(update ? "Bundled plugins update with OpenPets." : "Plugin is already installed as a bundled plugin.");
    if (!update && existing) return this.#error("Plugin is already installed.");
    if (update && (!existing || existing.source !== "catalog")) return this.#error("Catalog plugin is not installed.");
    if (existing?.source === "local") return this.#error("A local plugin with this id is already loaded.");
    const confirm = this.#confirmPermissions ?? defaultConfirmPermissions;
    try {
      const entry = await getCatalogPlugin(id, { ...this.#catalogOptions, fetchImpl: this.#fetchImpl ?? this.#catalogOptions?.fetchImpl, refresh: update });
      if (isEntryDisabled(entry)) throw new Error("Plugin is disabled in the catalog.");
      if (isEntryDeprecated(entry)) throw new Error("Plugin is deprecated in the catalog.");
      if (!isCatalogEntryCompatible(entry.minOpenPetsVersion, getMaxVersion(entry), this.#currentAppVersion)) throw new Error("Plugin is incompatible with this OpenPets version.");
      const zip = await downloadCatalogPluginZip(entry, this.#fetchImpl ?? this.#catalogOptions?.fetchImpl ?? fetch);
      const preview = await readCatalogPluginManifestFromZip({ catalogEntry: entry, zip, maxManifestBytes: this.#maxManifestBytes });
      const networkHosts = "network" in preview.manifest ? preview.manifest.network?.hosts : undefined;
      const approvalsChanged = existing ? !isPermissionSubset(preview.manifest.permissions, existing.approvedPermissions) || !isStringSubset(networkHosts ?? [], existing.approvedNetworkHosts ?? []) : true;
      if (approvalsChanged && !(await confirm(preview.manifest))) return { ok: true, snapshot: await this.getSnapshot() };
      const previousInstallBackup = existing ? `${existing.installPath}.rollback-${process.pid}-${Date.now()}` : undefined;
      if (previousInstallBackup && existing) await fs.cp(existing.installPath, previousInstallBackup, { recursive: true, force: true }).catch(() => undefined);
      const loaded = await installCatalogPluginPackage({ userDataPath: this.#userDataPath, catalogEntry: entry, zip, maxManifestBytes: this.#maxManifestBytes });
      const wasEnabled = existing?.enabled === true;
      try {
        this.stateStore.upsertRecord({ id: loaded.manifest.id, version: loaded.manifest.version, source: "catalog", installPath: loaded.installPath, manifestPath: loaded.manifestPath, manifestVersion: loaded.manifest.manifestVersion, runtime: loaded.manifest.runtime, sdkVersion: "sdkVersion" in loaded.manifest ? loaded.manifest.sdkVersion : getSdkVersion(entry), enabled: existing && !approvalsChanged ? existing.enabled : false, approvedPermissions: loaded.manifest.permissions, approvedNetworkHosts: networkHosts, config: existing?.config ?? {}, catalogDeprecated: isEntryDeprecated(entry) || undefined, catalogStatusReason: getStatusReason(entry) });
      } catch (error) {
        if (previousInstallBackup && existing) { await fs.rm(loaded.installPath, { recursive: true, force: true }).catch(() => undefined); await fs.rename(previousInstallBackup, existing.installPath).catch(() => undefined); }
        else await fs.rm(loaded.installPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      } finally {
        if (previousInstallBackup) await fs.rm(previousInstallBackup, { recursive: true, force: true }).catch(() => undefined);
      }
      if (wasEnabled || (existing && !approvalsChanged && existing.enabled)) await this.runtime.reloadPlugin(id);
      return { ok: true, snapshot: await this.getSnapshot() };
    } catch (error) { return this.#error(safeError(error)); }
  }

  async #safeRecord(record: PluginStateRecord): Promise<SafePluginRecord> {
    const base = { id: record.id, version: record.version, source: record.source, bundled: record.bundled, enabled: record.enabled, brokenReason: record.brokenReason, approvedPermissions: record.approvedPermissions, runtime: record.runtime, sdkVersion: record.sdkVersion, catalogDisabled: record.catalogDisabled, catalogDeprecated: record.catalogDeprecated, catalogStatusReason: record.catalogStatusReason };
    try {
      const manifest = await this.#readManifest(record);
      const config = getEffectivePluginConfig(manifest, record.config);
      const runtimeState = typeof (this.runtime as unknown as { getPluginState?: unknown }).getPluginState === "function" ? this.runtime.getPluginState(record.id) : { commands: [] };
      return { ...base, brokenReason: sanitizePluginUiMessage(record.brokenReason), name: manifest.name, description: manifest.description, icon: manifest.icon, configSchema: manifest.configSchema, effectiveConfig: config.ok ? config.config : undefined, configErrors: config.ok ? undefined : config.errors, commands: runtimeState.commands, status: runtimeState.status };
    } catch (error) {
      return { ...base, brokenReason: sanitizePluginUiMessage(record.brokenReason) ?? safeError(error) };
    }
  }

  async #updateCatalogMetadata(entry: PluginCatalogEntryV2 | { readonly id: string }): Promise<void> {
    const existing = this.stateStore.getRecord(entry.id);
    if (!existing || existing.source !== "catalog" || existing.bundled) return;
    const disabled = isEntryDisabled(entry);
    this.stateStore.upsertRecord({ ...existing, enabled: disabled ? false : existing.enabled, catalogDisabled: disabled || undefined, catalogDeprecated: isEntryDeprecated(entry) || undefined, catalogStatusReason: getStatusReason(entry), sdkVersion: getSdkVersion(entry) ?? existing.sdkVersion });
    if (disabled && existing.enabled) await this.runtime.reloadPlugin(entry.id);
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

  #findBundledSourceFolder(id: string): string | null {
    for (const root of this.#bundledPluginSourceDirs) {
      const candidate = join(root, id);
      if (existsSync(join(candidate, OPENPETS_PLUGIN_MANIFEST_FILENAME))) return candidate;
    }
    return null;
  }

  async #seedBundledPluginFromSource(sourceFolder: string, expectedId: string): Promise<void> {
    if (!this.#userDataPath) return;
    const source = await readLocalPluginSourceManifest({ sourceFolder, maxManifestBytes: this.#maxManifestBytes });
    if (source.manifest.id !== expectedId) throw new Error("Bundled plugin id mismatch.");
    const root = join(this.#userDataPath, "plugins");
    await ensureRealDirectory(root);
    const installPath = join(root, source.manifest.id);
    const manifestPath = join(installPath, OPENPETS_PLUGIN_MANIFEST_FILENAME);
    const tempPath = join(root, `.tmp-bundled-${source.manifest.id}-${process.pid}-${Date.now()}`);
    await fs.rm(tempPath, { recursive: true, force: true });
    await fs.mkdir(tempPath, { recursive: true });
    try {
      await fs.writeFile(join(tempPath, OPENPETS_PLUGIN_MANIFEST_FILENAME), source.manifestText, { mode: 0o600 });
      if (source.manifest.manifestVersion === 2) {
        if (source.entryText === undefined) throw new Error("Bundled plugin entry is missing.");
        const entryPath = join(tempPath, source.manifest.entry);
        await fs.mkdir(dirname(entryPath), { recursive: true });
        await fs.writeFile(entryPath, source.entryText, { mode: 0o600 });
      }
      await readSafePluginManifest({ installPath: tempPath, manifestPath: join(tempPath, OPENPETS_PLUGIN_MANIFEST_FILENAME), allowedPluginRoots: [root], maxManifestBytes: this.#maxManifestBytes, expectedId: source.manifest.id, expectedVersion: source.manifest.version });
      await replaceInstallDirectory(root, installPath, tempPath);
    } finally { await fs.rm(tempPath, { recursive: true, force: true }).catch(() => undefined); }
    await readSafePluginManifest({ installPath, manifestPath, allowedPluginRoots: [root], maxManifestBytes: this.#maxManifestBytes, expectedId: source.manifest.id, expectedVersion: source.manifest.version });
    const networkHosts = "network" in source.manifest ? source.manifest.network?.hosts : undefined;
    const existing = this.stateStore.getRecord(source.manifest.id);
    this.stateStore.upsertRecord({ id: source.manifest.id, version: source.manifest.version, source: "catalog", bundled: true, installPath, manifestPath, manifestVersion: source.manifest.manifestVersion, runtime: source.manifest.runtime, sdkVersion: "sdkVersion" in source.manifest ? source.manifest.sdkVersion : undefined, enabled: existing?.enabled ?? bundledEnabledByDefault.has(source.manifest.id), approvedPermissions: source.manifest.permissions, approvedNetworkHosts: networkHosts, config: existing?.config ?? {} });
  }

  #log(level: PluginLogLevel, message: string, fields?: Record<string, unknown>): void {
    const runtime = this.runtime as unknown as { log?: (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => void };
    runtime.log?.(level, message, fields);
  }
}

let appPluginService: PluginService | null = null;

export function initializePluginService(userDataPath: string, petApi: PluginPetApi, currentAppVersion = "0.0.0", jsHost?: PluginJsHost, runtimeLogger?: (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => void, disableCatalog?: boolean, bundledPluginSourceDirs: readonly string[] = [], seedBundledPlugins = true): PluginService {
  appPluginService = new PluginService({ userDataPath, petApi, currentAppVersion, jsHost, runtimeLogger, disableCatalog, bundledPluginSourceDirs, seedBundledPlugins });
  return appPluginService;
}

export type PluginCommandMenuItem = { readonly pluginId: string; readonly pluginName: string; readonly commandId: string; readonly commandTitle: string };
export async function getDefaultPetPluginCommands(maxPlugins = 8, maxCommandsPerPlugin = 8): Promise<PluginCommandMenuItem[]> {
  if (!appPluginService) return [];
  const snapshot = await appPluginService.getSnapshot();
  return snapshot.plugins.filter((plugin) => plugin.enabled && !plugin.brokenReason && plugin.commands && plugin.commands.length > 0)
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id) || a.id.localeCompare(b.id)).slice(0, maxPlugins)
    .flatMap((plugin) => [...(plugin.commands ?? [])].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, maxCommandsPerPlugin).map((command) => ({ pluginId: plugin.id, pluginName: plugin.name ?? plugin.id, commandId: command.id, commandTitle: command.title })));
}

export async function executeDefaultPetPluginCommand(pluginId: string, commandId: string): Promise<void> {
  if (!appPluginService) return;
  await appPluginService.executeCommand(pluginId, commandId);
}

export function stopPluginService(): void {
  appPluginService?.stop();
}

export function getPluginService(): PluginService {
  if (!appPluginService) throw new Error("Plugin service is not initialized.");
  return appPluginService;
}

export function setPluginServiceForTests(service: PluginService | null): void {
  appPluginService = service;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Plugin manifest is unavailable.";
  if (/manifest validation failed/i.test(message)) return "Plugin manifest validation failed.";
  if (/too large/i.test(message)) return "Plugin manifest is too large.";
  if (/outside allowed/i.test(message)) return "Plugin install path is outside allowed plugin roots.";
  if (/outside install/i.test(message)) return "Plugin manifest path is outside install path.";
  if (/path is invalid/i.test(message)) return "Plugin manifest path is invalid.";
  if (/id\/version/i.test(message)) return "Plugin manifest id/version does not match installed state.";
  if (/newer OpenPets version|incompatible with this OpenPets version/i.test(message)) return "Plugin requires a newer OpenPets version.";
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

function isStringSubset(next: readonly string[], approved: readonly string[]): boolean {
  const approvedSet = new Set(approved);
  return next.every((value) => approvedSet.has(value));
}

function isUnderPath(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

async function ensureRealDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Plugin directory is invalid.");
}

async function replaceInstallDirectory(root: string, installPath: string, tempPath: string): Promise<void> {
  const backupPath = join(root, `.bak-bundled-${process.pid}-${Date.now()}`);
  let hadExisting = false;
  try {
    await ensureRealDirectory(tempPath);
    try { await ensureRealDirectory(installPath); hadExisting = true; }
    catch (error) { if (getErrorCode(error) !== "ENOENT") throw error; }
    if (hadExisting) await fs.rename(installPath, backupPath);
    await fs.rename(tempPath, installPath);
    await fs.rm(backupPath, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(installPath, { recursive: true, force: true }).catch(() => undefined);
    if (hadExisting) await fs.rename(backupPath, installPath).catch(() => undefined);
    throw error;
  }
}

function getErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
}

function isCatalogEntryCompatible(minOpenPetsVersion: string | undefined, maxOpenPetsVersion: string | undefined, currentAppVersion: string): boolean {
  if (minOpenPetsVersion && compareSemver(currentAppVersion, minOpenPetsVersion) < 0) return false;
  if (maxOpenPetsVersion && compareSemver(currentAppVersion, maxOpenPetsVersion) > 0) return false;
  return true;
}

function isEntryDisabled(entry: object): boolean { return "disabled" in entry && entry.disabled === true; }
function isEntryDeprecated(entry: object): boolean { return "deprecated" in entry && entry.deprecated === true; }
function getStatusReason(entry: object): string | undefined { return "statusReason" in entry && typeof entry.statusReason === "string" ? entry.statusReason : undefined; }
function getSdkVersion(entry: object): string | undefined { return "sdkVersion" in entry && typeof entry.sdkVersion === "string" ? entry.sdkVersion : undefined; }
function getMaxVersion(entry: object): string | undefined { return "maxOpenPetsVersion" in entry && typeof entry.maxOpenPetsVersion === "string" ? entry.maxOpenPetsVersion : undefined; }
function getNetworkHosts(entry: object): readonly string[] | undefined { return "network" in entry && entry.network && typeof entry.network === "object" && "hosts" in entry.network && Array.isArray(entry.network.hosts) ? entry.network.hosts : undefined; }

function compareSemver(a: string, b: string): number {
  const pa = parseCoreVersion(a); const pb = parseCoreVersion(b);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

function parseCoreVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
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
