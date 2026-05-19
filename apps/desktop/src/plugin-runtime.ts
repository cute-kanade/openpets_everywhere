import { validateReaction, validateSayMessage, type OpenPetsReaction } from "./local-ipc-protocol.js";
import { resolvePluginNumericConfig, resolvePluginStringConfig } from "./plugin-config.js";
import { defaultMaxPluginManifestBytes, readSafePluginManifest } from "./plugin-manifest-reader.js";
import { type OpenPetsPluginManifest, type PluginAction } from "./plugin-manifest.js";
import type { PluginPetApi } from "./plugin-pet-api.js";
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
};

type CompiledTimer = { readonly intervalMs: number; readonly actions: readonly CompiledAction[] };
type CompiledAction = { readonly type: "pet.speak"; readonly message: string } | { readonly type: "pet.react"; readonly reaction: OpenPetsReaction };
type PluginRuntimeSlot = { generation: number; active: boolean; timers: PluginTimerHandle[] };

export class PluginRuntime {
  readonly #stateStore: PluginStateStore;
  readonly #petApi: PluginPetApi;
  readonly #scheduler: PluginRuntimeScheduler;
  readonly #allowedPluginRoots: readonly string[];
  readonly #maxManifestBytes: number;
  readonly #slots = new Map<string, PluginRuntimeSlot>();
  #active = false;

  constructor(options: PluginRuntimeOptions) {
    this.#stateStore = options.stateStore;
    this.#petApi = options.petApi;
    this.#scheduler = options.scheduler ?? realPluginRuntimeScheduler;
    this.#allowedPluginRoots = options.allowedPluginRoots;
    this.#maxManifestBytes = options.maxManifestBytes ?? defaultMaxPluginManifestBytes;
  }

  async start(): Promise<void> {
    this.#active = true;
    await this.reloadAll();
  }

  stop(): void {
    this.#active = false;
    for (const id of this.#slots.keys()) this.#cancelPlugin(id);
  }

  async reloadAll(): Promise<void> {
    for (const id of this.#slots.keys()) this.#cancelPlugin(id);
    for (const record of this.#stateStore.listRecords()) await this.reloadPlugin(record.id);
  }

  async reloadPlugin(id: string): Promise<void> {
    this.#cancelPlugin(id);
    if (!this.#active) return;
    const record = this.#stateStore.getRecord(id);
    if (!record || !record.enabled) return;
    const slot = this.#slotFor(id);
    const generation = slot.generation;

    try {
      const manifest = await readSafePluginManifest({ installPath: record.installPath, manifestPath: record.manifestPath, allowedPluginRoots: this.#allowedPluginRoots, maxManifestBytes: this.#maxManifestBytes, expectedId: record.id, expectedVersion: record.version });
      const timers = this.#compilePlugin(record, manifest);
      if (!this.#canCommitReload(record, generation)) return;
      this.#stateStore.clearBrokenReason(id);
      slot.active = true;
      for (const timer of timers) this.#scheduleTimer(id, slot, generation, timer);
    } catch (error) {
      if (this.#canCommitReload(record, generation)) this.#markBroken(id, error instanceof Error ? error.message : "Plugin runtime validation failed.");
    }
  }

  #canCommitReload(record: PluginStateRecord, generation: number): boolean {
    if (!this.#active) return false;
    const slot = this.#slots.get(record.id);
    if (!slot || slot.generation !== generation) return false;
    const current = this.#stateStore.getRecord(record.id);
    return current?.enabled === true && current.version === record.version && current.manifestPath === record.manifestPath && current.installPath === record.installPath;
  }

  #compilePlugin(record: PluginStateRecord, manifest: OpenPetsPluginManifest): CompiledTimer[] {
    const approved = new Set(record.approvedPermissions);
    for (const permission of manifest.permissions) if (!approved.has(permission)) throw new Error(`Plugin permission is not approved: ${permission}`);
    return manifest.triggers.map((trigger, index) => {
      if (!approved.has("timer")) throw new Error("Plugin timer permission is not approved.");
      const interval = resolveTimerInterval(record, manifest, trigger.everyMinutes, index);
      const actions = trigger.actions.map((action) => compileAction(record, manifest, action, approved));
      return { intervalMs: interval * 60_000, actions };
    });
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
    this.#cancelPlugin(id);
    this.#stateStore.setBrokenReason(id, reason);
  }

  #cancelPlugin(id: string): void {
    const slot = this.#slotFor(id);
    slot.active = false;
    slot.generation += 1;
    for (const timer of slot.timers) timer.cancel();
    slot.timers = [];
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
