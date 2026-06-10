import { promises as fs } from "node:fs";
import * as os from "node:os";
import { basename, extname } from "node:path";

import { app, clipboard, dialog, nativeTheme, net, Notification, shell } from "electron";

import { getDefaultPetWindowForPlugins } from "./default-pet-controller.js";
import { debug, warn } from "./logger.js";
import { playPetWindowAudio, stopPetWindowAudio } from "./pet-window.js";
import { PluginAiGateway } from "./plugin-ai-gateway.js";
import { readDroppedFileText, startPluginEventSources, subscribePluginEvent } from "./plugin-events-source.js";
import { PluginOauthBroker } from "./plugin-oauth.js";
import { openPluginPanel } from "./plugin-panels.js";
import { getPluginPlatformSettings, isInQuietHours } from "./plugin-platform-settings.js";
import {
  badgePluginPet, clearPluginPetsForPlugin, closeAllPluginPets, closePluginPet, getPluginPetArbiter, getPluginPetState, hidePluginPet, listPluginPets,
  movePluginPetBy, movePluginPetTo, movePluginPetToHome, onPluginPetTick, onPluginPetsChange, reactPluginPet,
  setPluginPetAnimation, setPluginPetFollowCursor, setPluginPetPhysics, setPluginPetScale, showPluginPet, spawnPluginPet, wanderPluginPet,
} from "./plugin-pet-registry.js";
import { motionStop } from "./pet-motion-engine.js";
import { PluginSecretsStore } from "./plugin-secrets.js";
import { showPluginToast } from "./plugin-toast.js";
import { pluginVoiceListen, pluginVoiceSpeak } from "./plugin-voice.js";
import type { PluginHostCapabilities, PluginPickedFileHost } from "./plugin-sdk-bridge.js";

/**
 * The Electron implementation of every SDK v3 host capability. Built once at
 * startup and injected into the plugin SDK bridge; the bridge owns validation,
 * permissions, and quotas — this layer only does the side effects.
 */

const maxPickedFileBytes = 16 * 1024 * 1024;
const maxAudioFileBytes = 1024 * 1024;

const audioMimeByExtension: Record<string, string> = { ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };

type PickedFileEntry = { path: string; name: string; sizeBytes: number };

let cpuSample: { idle: number; total: number } | null = null;

function sampleCpus(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function cpuPercent(): number {
  const current = sampleCpus();
  const previous = cpuSample ?? current;
  cpuSample = current;
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100)));
}

export type ElectronPluginHostCapabilities = PluginHostCapabilities & {
  readonly secretsStore: PluginSecretsStore;
  readonly aiGateway: PluginAiGateway;
  /** Tear down everything a plugin owns on stop/reload. */
  clearPlugin(pluginId: string): void;
  shutdown(): void;
};

let activeCapabilities: ElectronPluginHostCapabilities | null = null;

/** The live capabilities instance (Control Center settings IPC). */
export function getPluginHostCapabilitiesForUi(): ElectronPluginHostCapabilities | null {
  return activeCapabilities;
}

export function createElectronPluginHostCapabilities(userDataPath: string): ElectronPluginHostCapabilities {
  startPluginEventSources();
  const secretsStore = new PluginSecretsStore(userDataPath);
  const aiGateway = new PluginAiGateway(secretsStore);
  const oauthBroker = new PluginOauthBroker(secretsStore);
  const pickedFiles = new Map<string, PickedFileEntry>();
  let nextPickedFileId = 0;

  const capabilities: ElectronPluginHostCapabilities = {
    secretsStore,
    aiGateway,
    bubbles: {
      async show({ petId, pluginId, bubble, callbacks }) {
        return getPluginPetArbiter(petId).show(pluginId, bubble, callbacks);
      },
    },
    audio: {
      async play(spec, volume) {
        const window = getDefaultPetWindowForPlugins();
        if (!window) { debug("plugin", "audio skipped", { reason: "no-pet-window" }); return; }
        if (spec.kind === "named") {
          playPetWindowAudio(window, { kind: "named", name: spec.name, volume });
          return;
        }
        const stat = await fs.stat(spec.path);
        if (!stat.isFile() || stat.size > maxAudioFileBytes) throw new Error("Plugin sound file is missing or too large.");
        const mime = audioMimeByExtension[extname(spec.path).toLowerCase()];
        if (!mime) throw new Error("Plugin sound format is not supported.");
        const bytes = await fs.readFile(spec.path);
        playPetWindowAudio(window, { kind: "data", dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, volume });
      },
      async stop() {
        const window = getDefaultPetWindowForPlugins();
        if (window) stopPetWindowAudio(window);
      },
    },
    events: {
      subscribe(event, handler) {
        return subscribePluginEvent(event, handler);
      },
    },
    pets: {
      list: () => listPluginPets(),
      spawn: (opts) => spawnPluginPet(opts),
      close: (pluginId, petHandleId) => closePluginPet(pluginId, petHandleId),
      show: async (petHandleId) => showPluginPet(petHandleId),
      hide: async (petHandleId) => hidePluginPet(petHandleId),
      react: async (petHandleId, reaction) => reactPluginPet(petHandleId, reaction),
      setAnimation: async (petHandleId, spec) => setPluginPetAnimation(petHandleId, spec),
      setScale: async (petHandleId, scale) => setPluginPetScale(petHandleId, scale),
      badge: async (petHandleId, reaction) => badgePluginPet(petHandleId, reaction),
      moveBy: (petHandleId, opts) => movePluginPetBy(petHandleId, opts),
      wander: (petHandleId, opts) => wanderPluginPet(petHandleId, opts),
      moveToHome: (petHandleId) => movePluginPetToHome(petHandleId),
      moveTo: (petHandleId, point, opts) => movePluginPetTo(petHandleId, point, opts),
      followCursor: async (petHandleId, _pluginId, opts) => setPluginPetFollowCursor(petHandleId, opts),
      physics: async (petHandleId, _pluginId, opts) => setPluginPetPhysics(petHandleId, opts),
      getState: async (petHandleId) => getPluginPetState(petHandleId),
      onTick: (petHandleId, handler) => onPluginPetTick(petHandleId, handler),
      onChange: (handler) => onPluginPetsChange(handler),
    },
    toast: (spec) => showPluginToast(spec),
    async notify(spec) {
      if (!Notification.isSupported()) throw new Error("OS notifications are not supported on this system.");
      new Notification({ title: spec.title, body: spec.body, silent: spec.sound !== true }).show();
    },
    panels: {
      open: (opts) => openPluginPanel(opts),
    },
    secrets: {
      get: (pluginId, key) => secretsStore.get(pluginId, key),
      set: (pluginId, key, value) => secretsStore.set(pluginId, key, value),
      delete: (pluginId, key) => secretsStore.delete(pluginId, key),
      has: (pluginId, key) => secretsStore.has(pluginId, key),
    },
    ai: {
      available: () => aiGateway.available(),
      complete: (req) => aiGateway.complete(req),
      stream: (req, onToken) => aiGateway.stream(req, onToken),
    },
    voice: {
      speak: (text, opts) => pluginVoiceSpeak(text, opts),
      listen: (opts) => pluginVoiceListen(aiGateway, { timeoutMs: opts.timeoutMs ?? 10_000 }),
    },
    auth: {
      oauth: (pluginId, config) => oauthBroker.oauth(pluginId, config),
      refresh: (pluginId, provider) => oauthBroker.refresh(pluginId, provider),
      signOut: (pluginId, provider) => oauthBroker.signOut(pluginId, provider),
    },
    files: {
      async pick(opts) {
        const filters = opts.accept && opts.accept.length > 0
          ? [{ name: "Allowed files", extensions: opts.accept.map((ext) => ext.replace(/^[.]/, "")) }]
          : undefined;
        const result = await dialog.showOpenDialog({ properties: opts.multiple ? ["openFile", "multiSelections"] : ["openFile"], filters });
        if (result.canceled) return [];
        const out: PluginPickedFileHost[] = [];
        for (const path of result.filePaths.slice(0, 16)) {
          try {
            const stat = await fs.stat(path);
            if (!stat.isFile()) continue;
            const fileId = `pick-${++nextPickedFileId}`;
            pickedFiles.set(fileId, { path, name: basename(path), sizeBytes: stat.size });
            out.push({ fileId, name: basename(path), sizeBytes: stat.size });
          } catch { /* unreadable selections are skipped */ }
        }
        return out;
      },
      async read(fileId, encoding) {
        const dropped = readDroppedFileText(fileId);
        if (dropped !== undefined) return encoding === "text" ? dropped : new TextEncoder().encode(dropped);
        const entry = pickedFiles.get(fileId);
        if (!entry) throw new Error("Plugin file handle is invalid.");
        const stat = await fs.stat(entry.path);
        if (stat.size > maxPickedFileBytes) throw new Error("Picked file is too large to read.");
        const bytes = await fs.readFile(entry.path);
        return encoding === "text" ? bytes.toString("utf8") : new Uint8Array(bytes);
      },
      async save(opts) {
        const result = await dialog.showSaveDialog({ defaultPath: opts.suggestedName });
        if (result.canceled || !result.filePath) return;
        await fs.writeFile(result.filePath, typeof opts.data === "string" ? opts.data : Buffer.from(opts.data));
      },
    },
    system: {
      async info() {
        return {
          platform: process.platform === "darwin" ? "mac" as const : process.platform === "win32" ? "win" as const : "linux" as const,
          locale: app.getLocale() || "en-US",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
          theme: nativeTheme.shouldUseDarkColors ? "dark" as const : "light" as const,
          appVersion: app.getVersion(),
          online: net.online,
        };
      },
      async metrics() {
        const memory = process.getSystemMemoryInfo();
        const memUsedPercent = memory.total > 0 ? Math.round(Math.min(100, Math.max(0, (1 - memory.free / memory.total) * 100))) : 0;
        return { cpuPercent: cpuPercent(), memUsedPercent };
      },
      async openExternal(url) {
        await shell.openExternal(url);
      },
      async readClipboardText() {
        return clipboard.readText().slice(0, 64 * 1024);
      },
      async writeClipboardText(text) {
        clipboard.writeText(text);
      },
    },
    settings: {
      audioAllowed: () => getPluginPlatformSettings().allowPluginAudio,
      dynamicSpeechAllowed: () => getPluginPlatformSettings().allowDynamicSpeech,
      voiceAllowed: () => getPluginPlatformSettings().allowPluginVoice,
      listenAllowed: () => getPluginPlatformSettings().allowMicrophone,
      inQuietHours: () => isInQuietHours(),
    },
    clearPlugin(pluginId: string) {
      try {
        clearPluginPetsForPlugin(pluginId);
      } catch (error) {
        warn("plugin", "plugin pet teardown failed", { pluginId, error: error instanceof Error ? error.message : String(error) });
      }
      motionStop("default");
    },
    shutdown() {
      closeAllPluginPets();
    },
  };
  // Prime the CPU sampler so the first metrics() call has a delta to use.
  cpuSample = sampleCpus();
  activeCapabilities = capabilities;
  return capabilities;
}
