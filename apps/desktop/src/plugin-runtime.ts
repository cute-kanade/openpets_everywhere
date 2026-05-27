import { promises as fs } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { validateReaction, validateSayMessage, type OpenPetsReaction } from "./local-ipc-protocol.js";
import { resolvePluginNumericConfig, resolvePluginStringConfig } from "./plugin-config.js";
import type { PluginJsHost, PluginJsHostInstance } from "./plugin-js-host.js";
import { defaultMaxPluginManifestBytes, readSafePluginManifest } from "./plugin-manifest-reader.js";
import { type OpenPetsJavascriptPluginManifest, type OpenPetsPluginManifest, type PluginAction } from "./plugin-manifest.js";
import type { PluginPetApi } from "./plugin-pet-api.js";
import { PluginSdkBridge, type PluginLogLevel, type PluginRuntimePublicState, type PluginStorageStore } from "./plugin-sdk-bridge.js";
import type { PluginStateRecord, PluginStateStore } from "./plugin-state.js";

export interface PluginTimerHandle { cancel(): void }
export interface PluginRuntimeScheduler { setTimeout(callback: () => void, delayMs: number): PluginTimerHandle }

export const realPluginRuntimeScheduler: PluginRuntimeScheduler = {
  setTimeout(callback, delayMs) {
    const timeout = setTimeout(callback, delayMs);
    timeout.unref?.();
    return { cancel: () => clearTimeout(timeout) };
  },
};

export type PluginRuntimeOptions = {
  readonly stateStore: PluginStateStore;
  readonly petApi: PluginPetApi;
  readonly scheduler?: PluginRuntimeScheduler;
  readonly allowedPluginRoots: readonly string[];
  readonly maxManifestBytes?: number;
  readonly jsHost?: PluginJsHost;
  readonly storageStore?: PluginStorageStore;
  readonly logger?: (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => void;
};

type CompiledTimer = { readonly intervalMs: number; readonly actions: readonly CompiledAction[] };
type CompiledAction = { readonly type: "pet.speak"; readonly message: string } | { readonly type: "pet.react"; readonly reaction: OpenPetsReaction };
type PluginRuntimeSlot = { generation: number; active: boolean; timers: PluginTimerHandle[]; jsHost?: PluginJsHostInstance };

export class PluginRuntime {
  readonly #stateStore: PluginStateStore;
  readonly #petApi: PluginPetApi;
  readonly #scheduler: PluginRuntimeScheduler;
  readonly #allowedPluginRoots: readonly string[];
  readonly #maxManifestBytes: number;
  readonly #jsHost?: PluginJsHost;
  readonly #sdkBridge: PluginSdkBridge;
  readonly #logger: (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => void;
  readonly #slots = new Map<string, PluginRuntimeSlot>();
  #active = false;

  constructor(options: PluginRuntimeOptions) {
    this.#stateStore = options.stateStore;
    this.#petApi = options.petApi;
    this.#scheduler = options.scheduler ?? realPluginRuntimeScheduler;
    this.#allowedPluginRoots = options.allowedPluginRoots;
    this.#maxManifestBytes = options.maxManifestBytes ?? defaultMaxPluginManifestBytes;
    this.#jsHost = options.jsHost;
    this.#logger = options.logger ?? (() => undefined);
    this.#sdkBridge = new PluginSdkBridge({ stateStore: this.#stateStore, petApi: this.#petApi, scheduler: this.#scheduler, storage: options.storageStore, onError: (id, reason) => this.#markBroken(id, reason), logger: this.#logger });
  }

  async start(): Promise<void> {
    this.#active = true;
    await this.reloadAll();
  }

  stop(): void {
    this.#active = false;
    for (const id of this.#slots.keys()) this.#cancelPlugin(id);
  }

  getPluginState(id: string): PluginRuntimePublicState { return this.#sdkBridge.getPublicState(id); }
  executeCommand(id: string, commandId: string, args?: Record<string, unknown>): Promise<void> { return this.#sdkBridge.executeCommand(id, commandId, args); }
  notifyConfigChanged(id: string): void { this.#sdkBridge.notifyConfigChanged(id); }

  async reloadAll(): Promise<void> {
    for (const id of this.#slots.keys()) this.#cancelPlugin(id);
    const records = this.#stateStore.listRecords();
    const jsIds: string[] = [];
    for (const record of records) {
      if (record.runtime === "javascript" || record.manifestVersion === 2) jsIds.push(record.id);
      else await this.reloadPlugin(record.id);
    }
    await Promise.all(jsIds.map((id) => this.reloadPlugin(id)));
  }

  async reloadPlugin(id: string): Promise<void> {
    this.#cancelPlugin(id);
    if (!this.#active) return;
    const record = this.#stateStore.getRecord(id);
    if (!record || !record.enabled || record.catalogDisabled) return;
    const slot = this.#slotFor(id);
    const generation = slot.generation;

    try {
      const manifest = await readSafePluginManifest({ installPath: record.installPath, manifestPath: record.manifestPath, allowedPluginRoots: this.#allowedPluginRoots, maxManifestBytes: this.#maxManifestBytes, expectedId: record.id, expectedVersion: record.version });
      if (!this.#canCommitReload(record, generation)) return;
      this.#stateStore.clearBrokenReason(id);
      if (manifest.runtime === "javascript") {
        await this.#startJavascriptPlugin(record, manifest, slot, generation);
      } else {
        const timers = this.#compileDeclarativePlugin(record, manifest);
        if (!this.#canCommitReload(record, generation)) return;
        slot.active = true;
        for (const timer of timers) this.#scheduleTimer(id, slot, generation, timer);
      }
    } catch (error) {
      if (this.#canCommitReload(record, generation)) this.#markBroken(id, error instanceof Error ? error.message : "Plugin runtime validation failed.");
    }
  }

  #canCommitReload(record: PluginStateRecord, generation: number): boolean {
    if (!this.#active) return false;
    const slot = this.#slots.get(record.id);
    if (!slot || slot.generation !== generation) return false;
    const current = this.#stateStore.getRecord(record.id);
    return current?.enabled === true && current.catalogDisabled !== true && current.version === record.version && current.manifestPath === record.manifestPath && current.installPath === record.installPath;
  }

  #compileDeclarativePlugin(record: PluginStateRecord, manifest: OpenPetsPluginManifest): CompiledTimer[] {
    if (manifest.runtime !== "declarative") throw new Error("Plugin runtime is not declarative.");
    const approved = new Set(record.approvedPermissions);
    for (const permission of manifest.permissions) if (!approved.has(permission)) throw new Error(`Plugin permission is not approved: ${permission}`);
    return manifest.triggers.map((trigger, index) => {
      if (!approved.has("timer")) throw new Error("Plugin timer permission is not approved.");
      const interval = resolveTimerInterval(record, manifest, trigger.everyMinutes, index);
      const actions = trigger.actions.map((action) => compileAction(record, manifest, action, approved));
      return { intervalMs: interval * 60_000, actions };
    });
  }

  async #startJavascriptPlugin(record: PluginStateRecord, manifest: OpenPetsJavascriptPluginManifest, slot: PluginRuntimeSlot, generation: number): Promise<void> {
    if (!this.#jsHost) throw new Error("JavaScript plugin host is unavailable.");
    const approved = new Set(record.approvedPermissions);
    for (const permission of manifest.permissions) if (!approved.has(permission)) throw new Error(`Plugin permission is not approved: ${permission}`);
    const entryPath = await resolveJavascriptEntry(record.installPath, manifest.entry);
    const sdk = this.#sdkBridge.createApi(record, manifest);
    const host = await this.#jsHost.startPlugin({ record, manifest, entryPath, sdk, onBroken: (reason) => {
      if (this.#canCommitReload(record, generation)) this.#markBroken(record.id, reason);
    } });
    if (!this.#canCommitReload(record, generation)) {
      host.stop();
      return;
    }
    slot.jsHost = host;
    slot.active = true;
    this.#logger("info", "plugin started", { id: record.id, version: record.version, source: record.source, runtime: manifest.runtime });
  }

  #scheduleTimer(id: string, slot: PluginRuntimeSlot, generation: number, timer: CompiledTimer): void {
    let handle: PluginTimerHandle | undefined;
    handle = this.#scheduler.setTimeout(() => {
      if (handle) slot.timers = slot.timers.filter((timerHandle) => timerHandle !== handle);
      if (!this.#active || !slot.active || slot.generation !== generation) return;
      void this.#runTimer(id, slot, generation, timer);
    }, timer.intervalMs);
    slot.timers.push(handle);
  }

  async #runTimer(id: string, slot: PluginRuntimeSlot, generation: number, timer: CompiledTimer): Promise<void> {
    try {
      for (const action of timer.actions) {
        if (!this.#active || !slot.active || slot.generation !== generation) return;
        if (action.type === "pet.speak") await this.#petApi.speak(action.message);
        else await this.#petApi.react(action.reaction);
      }
      if (this.#active && slot.active && slot.generation === generation) this.#scheduleTimer(id, slot, generation, timer);
    } catch (error) {
      if (this.#active && slot.active && slot.generation === generation) this.#markBroken(id, error instanceof Error ? error.message : "Plugin action failed.");
    }
  }

  #markBroken(id: string, reason: string): void {
    this.#logger("error", "plugin marked broken", { id, reason });
    this.#cancelPlugin(id);
    this.#stateStore.setBrokenReason(id, reason);
  }

  #cancelPlugin(id: string): void {
    const slot = this.#slotFor(id);
    slot.active = false;
    slot.generation += 1;
    for (const timer of slot.timers) timer.cancel();
    slot.timers = [];
    slot.jsHost?.stop();
    slot.jsHost = undefined;
    this.#sdkBridge.clearPlugin(id);
  }

  #slotFor(id: string): PluginRuntimeSlot {
    let slot = this.#slots.get(id);
    if (!slot) {
      slot = { generation: 0, active: false, timers: [] };
      this.#slots.set(id, slot);
    }
    return slot;
  }
}

function compileAction(record: PluginStateRecord, manifest: OpenPetsPluginManifest, action: PluginAction, approved: Set<string>): CompiledAction {
  if (action.type === "pet.speak") {
    if (!approved.has("pet:speak")) throw new Error("Plugin speak permission is not approved.");
    const message = typeof action.message === "string" ? action.message : resolvePluginStringConfig(manifest, record.config, action.message.config, "text");
    return { type: "pet.speak", message: validateSayMessage(message) };
  }
  if (!approved.has("pet:reaction")) throw new Error("Plugin reaction permission is not approved.");
  const reaction = typeof action.reaction === "string" ? action.reaction : resolvePluginStringConfig(manifest, record.config, action.reaction.config, "select");
  return { type: "pet.react", reaction: validateReaction(reaction) };
}

function resolveTimerInterval(record: PluginStateRecord, manifest: OpenPetsPluginManifest, value: number | { config: string }, triggerIndex: number): number {
  const interval = typeof value === "number" ? value : resolvePluginNumericConfig(manifest, record.config, value.config, { min: 5 });
  if (!Number.isInteger(interval) || interval < 5) throw new Error(`Plugin timer interval for trigger ${triggerIndex} must be an integer of at least 5 minutes.`);
  return interval;
}

async function resolveJavascriptEntry(installPath: string, entry: string): Promise<string> {
  const installRoot = resolve(installPath);
  const entryPath = resolve(installRoot, entry);
  const rel = relative(installRoot, entryPath);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) throw new Error("JavaScript plugin entry is outside install path.");
  const stat = await fs.lstat(entryPath);
  if (stat.isSymbolicLink()) throw new Error("JavaScript plugin entry must not be a symlink.");
  if (!stat.isFile()) throw new Error("JavaScript plugin entry must be a file.");
  const [realInstallRoot, realEntryPath] = await Promise.all([fs.realpath(installRoot), fs.realpath(entryPath)]);
  const realRel = relative(realInstallRoot, realEntryPath);
  if (realRel === "" || realRel.startsWith("..") || realRel.includes(`..${sep}`)) throw new Error("JavaScript plugin entry is outside install path.");
  return realEntryPath;
}
