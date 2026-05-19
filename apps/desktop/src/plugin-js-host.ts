import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, session, type Event, type IpcMainInvokeEvent, type RenderProcessGoneDetails, type Session, type WebContents } from "electron";

import type { OpenPetsJavascriptPluginManifest } from "./plugin-manifest.js";
import type { PluginSdkApi } from "./plugin-sdk-bridge.js";
import type { PluginStateRecord } from "./plugin-state.js";

export type PluginJsHostStartOptions = {
  readonly record: PluginStateRecord;
  readonly manifest: OpenPetsJavascriptPluginManifest;
  readonly entryPath: string;
  readonly sdk?: PluginSdkApi;
  readonly startupTimeoutMs?: number;
  readonly onBroken: (reason: string) => void;
};

export interface PluginJsHostInstance { stop(): void }

export interface PluginJsHost { startPlugin(options: PluginJsHostStartOptions): Promise<PluginJsHostInstance> }
const configDisposers = new WeakMap<WebContents, Map<string, () => void>>();

export class ElectronPluginJsHost implements PluginJsHost {
  readonly #startupTimeoutMs: number;

  constructor(options: { readonly startupTimeoutMs?: number } = {}) {
    this.#startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  }

  async startPlugin(options: PluginJsHostStartOptions): Promise<PluginJsHostInstance> {
    const partition = `openpets-plugin:${encodeURIComponent(options.record.id)}:${Date.now()}`;
    const pluginSession = session.fromPartition(partition, { cache: false });
    const entryUrl = pathToFileURL(options.entryPath).toString();
    const moduleUrl = buildPluginModuleUrl(await readFile(options.entryPath, "utf8"), entryUrl);
    const htmlUrl = buildPluginHtmlUrl(moduleUrl);
    const token = `${options.record.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sdkChannel = `openpets:plugin-sdk:${token}`;
    hardenSession(pluginSession, { entryUrl: moduleUrl, htmlUrl });

    const window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition,
        preload: getPluginSdkPreloadPath(),
        additionalArguments: [`--openpets-plugin-token=${token}`],
      },
    });

    hardenWebContents(window.webContents, options.onBroken);
    installSdkHandler(sdkChannel, window.webContents, options.sdk);

    const stopped = { value: false };
    const instance: PluginJsHostInstance = { stop: () => { stopped.value = true; ipcMain.removeHandler(sdkChannel); void stopRegisteredPlugin(window.webContents).catch(() => undefined); cleanupSession(pluginSession); if (!window.isDestroyed()) window.destroy(); } };

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(new Error("JavaScript plugin startup timed out.")), options.startupTimeoutMs ?? this.#startupTimeoutMs);
      const cleanup = () => { clearTimeout(timeout); window.webContents.removeListener("did-finish-load", loaded); window.webContents.removeListener("render-process-gone", gone); window.webContents.removeListener("unresponsive", unresponsive); };
      const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); instance.stop(); reject(error); };
      const loaded = () => {
        void runRegistrationHandshake(window.webContents, moduleUrl, options.sdk).then(() => { if (settled) return; settled = true; cleanup(); resolve(); }, (error: unknown) => fail(error instanceof Error ? error : new Error("JavaScript plugin registration failed.")));
      };
      const gone = (_event: Event, details: RenderProcessGoneDetails) => fail(new Error(`JavaScript plugin renderer exited: ${details.reason}`));
      const unresponsive = () => fail(new Error("JavaScript plugin renderer became unresponsive."));
      window.webContents.once("did-finish-load", loaded);
      window.webContents.once("render-process-gone", gone);
      window.webContents.once("unresponsive", unresponsive);
      window.loadURL(htmlUrl).catch((error: unknown) => fail(error instanceof Error ? error : new Error("JavaScript plugin failed to load.")));
    });

    if (stopped.value) throw new Error("JavaScript plugin stopped during startup.");
    return instance;
  }
}

function getPluginSdkPreloadPath(): string {
  return `${app.getAppPath()}/plugin-sdk-preload.cjs`;
}

function installSdkHandler(channel: string, contents: WebContents, sdk: PluginSdkApi | undefined): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, path: unknown, args: unknown[]) => {
    if (event.sender !== contents) throw new Error("Invalid plugin SDK sender.");
    if (!sdk || typeof path !== "string" || !Array.isArray(args)) throw new Error("Invalid plugin SDK call.");
    return dispatchSdkCall(contents, sdk, path, args);
  });
}

async function dispatchSdkCall(contents: WebContents, sdk: PluginSdkApi, path: string, args: unknown[]): Promise<unknown> {
  const runCallback = (id: unknown) => typeof id === "string" ? () => contents.executeJavaScript(`globalThis.__openPetsRunCallback(${JSON.stringify(id)}, [])`, true) : undefined;
  switch (path) {
    case "pet.speak": return sdk.pet.speak(String(args[0]));
    case "pet.react": return sdk.pet.react(args[0] as never);
    case "schedule.once": return sdk.schedule.once(String(args[0]), Number(args[1]), runCallback(args[2]) ?? (() => undefined));
    case "schedule.every": return sdk.schedule.every(String(args[0]), Number(args[1]), runCallback(args[2]) ?? (() => undefined));
    case "schedule.daily": return sdk.schedule.daily(String(args[0]), args[1] as never, runCallback(args[2]) ?? (() => undefined));
    case "schedule.cancel": return sdk.schedule.cancel(String(args[0]));
    case "schedule.cancelAll": return sdk.schedule.cancelAll();
    case "storage.get": return sdk.storage.get(String(args[0]));
    case "storage.set": return sdk.storage.set(String(args[0]), args[1]);
    case "storage.delete": return sdk.storage.delete(String(args[0]));
    case "config.get": return sdk.config.get();
    case "config.onChange": { const id = String(args[0] ?? ""); if (!id) return { ok: false }; const disposer = sdk.config.onChange((config) => { void contents.executeJavaScript(`globalThis.__openPetsRunCallback(${JSON.stringify(id)}, [${JSON.stringify(config)}])`, true); }); let map = configDisposers.get(contents); if (!map) { map = new Map(); configDisposers.set(contents, map); } map.set(id, disposer); return { ok: true }; }
    case "config.offChange": { const id = String(args[0] ?? ""); const disposer = configDisposers.get(contents)?.get(id); disposer?.(); configDisposers.get(contents)?.delete(id); return { ok: true }; }
    case "commands.register": return sdk.commands.register(args[0] as never, runCallback(args[1]) ?? (() => undefined));
    case "commands.unregister": return sdk.commands.unregister(String(args[0]));
    case "status.set": return sdk.status.set(args[0] as never);
    case "status.clear": return sdk.status.clear();
    case "http.fetch": return sdk.http.fetch(String(args[0]), args[1]);
    case "log.debug": return sdk.log.debug(...args);
    case "log.info": return sdk.log.info(...args);
    case "log.warn": return sdk.log.warn(...args);
    case "log.error": return sdk.log.error(...args);
    default: throw new Error("Unknown plugin SDK call.");
  }
}

export type PluginJsRequestPolicy = { readonly entryUrl: string; readonly htmlUrl: string };

export function isAllowedPluginJsRequest(urlText: string, policy: PluginJsRequestPolicy): boolean {
  if (urlText === policy.entryUrl || urlText === policy.htmlUrl || urlText === "about:blank") return true;
  try {
    const url = new URL(urlText);
    return url.protocol === "data:" && urlText === policy.htmlUrl;
  } catch {
    return false;
  }
}

function hardenSession(pluginSession: Session, policy: PluginJsRequestPolicy): void {
  pluginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  pluginSession.setPermissionCheckHandler(() => false);
  pluginSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedPluginJsRequest(details.url, policy) });
  });
}

function cleanupSession(pluginSession: Session): void {
  void pluginSession.clearStorageData().catch(() => undefined);
  void pluginSession.clearCache().catch(() => undefined);
}

function hardenWebContents(contents: WebContents, onBroken: (reason: string) => void): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.session.on("will-download", (event) => event.preventDefault());
  contents.on("render-process-gone", (_event, details) => onBroken(`JavaScript plugin renderer exited: ${details.reason}`));
  contents.on("unresponsive", () => onBroken("JavaScript plugin renderer became unresponsive."));
}

export function buildPluginHtmlUrl(entryUrl: string): string {
  void entryUrl;
  const csp = `default-src 'none'; script-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; form-action 'none'; base-uri 'none'`;
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content=${JSON.stringify(csp)}>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function buildPluginModuleUrl(source: string, sourceUrl: string): string {
  const withSourceUrl = `${source}\n//# sourceURL=${sourceUrl.replace(/\s/g, "%20")}`;
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(withSourceUrl)}`;
}

export function buildPluginRegistrationHandshakeCode(entryUrl: string): string {
  return `(() => new Promise((resolve, reject) => {
    let done = false;
    const sdk = globalThis.__openPetsSdk;
    const finish = (value) => { if (done) return; done = true; globalThis.__openPetsRegisteredPlugin = value; Promise.resolve(value && typeof value.start === "function" ? value.start(sdk) : undefined).then(() => resolve(true), reject); };
    Object.defineProperty(globalThis, "OpenPetsPlugin", { configurable: false, enumerable: false, writable: false, value: Object.freeze({ register: finish }) });
    import(${JSON.stringify(entryUrl)}).then((mod) => {
      if (mod && typeof mod.register === "function") Promise.resolve(mod.register(globalThis.OpenPetsPlugin)).then(finish, reject);
      else if (mod && typeof mod.default === "function") Promise.resolve(mod.default(globalThis.OpenPetsPlugin)).then(finish, reject);
      else setTimeout(() => { if (!done) reject(new Error("JavaScript plugin did not register.")); }, 0);
    }, reject);
  }))();`;
}

function runRegistrationHandshake(contents: WebContents, entryUrl: string, sdk: PluginSdkApi | undefined): Promise<unknown> {
  void sdk;
  return contents.executeJavaScript(buildPluginRegistrationHandshakeCode(entryUrl), true);
}

function stopRegisteredPlugin(contents: WebContents): Promise<unknown> {
  const code = `Promise.resolve(globalThis.__openPetsRegisteredPlugin && typeof globalThis.__openPetsRegisteredPlugin.stop === "function" ? globalThis.__openPetsRegisteredPlugin.stop() : undefined).then(() => true)`;
  return contents.executeJavaScript(code, true);
}
