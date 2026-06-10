import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, session, type IpcMainEvent } from "electron";

import { debug, info } from "./logger.js";
import { isUnderPath } from "./plugin-manifest-reader.js";
import type { PluginPanelHostHandle } from "./plugin-sdk-bridge.js";

/**
 * Sandboxed plugin panels (§7.2): the plugin ships its own HTML/CSS/JS, loaded
 * in a dedicated BrowserWindow that reuses the plugin-host sandbox posture —
 * contextIsolation, sandbox, no node, a unique non-persistent session, and a
 * request filter restricted to files inside the plugin's install directory.
 * The page talks to its plugin only through the clone-safe message channel
 * exposed by `panel-preload.cjs`.
 */

export type OpenPluginPanelOptions = {
  readonly pluginId: string;
  readonly installPath: string;
  readonly panelPath: string;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly onMessage: (msg: unknown) => void;
  readonly onClosed: () => void;
};

const maxPanelMessageBytes = 64 * 1024;

export async function openPluginPanel(options: OpenPluginPanelOptions): Promise<PluginPanelHostHandle> {
  const realInstall = await fs.realpath(options.installPath);
  const realPanel = await fs.realpath(options.panelPath);
  if (!isUnderPath(realPanel, realInstall)) throw new Error("Plugin panel page is outside the plugin install directory.");
  const panelStat = await fs.lstat(realPanel);
  if (!panelStat.isFile()) throw new Error("Plugin panel page is not a file.");

  const token = randomBytes(16).toString("hex");
  const channel = `openpets:plugin-panel:${token}`;
  const partition = `openpets-panel:${encodeURIComponent(options.pluginId)}:${Date.now()}`;
  const panelSession = session.fromPartition(partition, { cache: false });
  panelSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  panelSession.setPermissionCheckHandler(() => false);
  const allowedRoot = pathToFileURL(realInstall).toString();
  panelSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === "about:blank" || (details.url.startsWith("file://") && (details.url === allowedRoot || details.url.startsWith(`${allowedRoot.endsWith("/") ? allowedRoot : `${allowedRoot}/`}`)));
    callback({ cancel: !allowed });
  });

  const window = new BrowserWindow({
    title: options.title ?? "OpenPets plugin",
    width: options.width ?? 420,
    height: options.height ?? 480,
    show: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition,
      preload: `${app.getAppPath()}/panel-preload.cjs`,
      additionalArguments: [`--openpets-panel-token=${token}`],
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  panelSession.on("will-download", (event) => event.preventDefault());

  const handleToPlugin = (event: IpcMainEvent, msg: unknown): void => {
    if (event.sender !== window.webContents) return;
    try {
      const text = JSON.stringify(msg ?? null);
      if (text !== undefined && Buffer.byteLength(text) <= maxPanelMessageBytes) options.onMessage(JSON.parse(text));
    } catch { /* non-clone-safe panel messages are dropped */ }
  };
  const handleCloseRequest = (event: IpcMainEvent): void => {
    if (event.sender !== window.webContents) return;
    if (!window.isDestroyed()) window.close();
  };
  ipcMain.on(`${channel}:to-plugin`, handleToPlugin);
  ipcMain.on(`${channel}:close`, handleCloseRequest);
  window.once("closed", () => {
    ipcMain.off(`${channel}:to-plugin`, handleToPlugin);
    ipcMain.off(`${channel}:close`, handleCloseRequest);
    void panelSession.clearStorageData().catch(() => undefined);
    options.onClosed();
  });

  debug("plugin", "panel loading", { pluginId: options.pluginId, panel: dirname(realPanel) });
  await window.loadFile(realPanel);
  window.show();
  info("plugin", "panel opened", { pluginId: options.pluginId });

  return {
    id: token,
    show: async () => { if (!window.isDestroyed()) window.show(); },
    hide: async () => { if (!window.isDestroyed()) window.hide(); },
    postMessage: async (msg) => { if (!window.isDestroyed()) window.webContents.send(`${channel}:message`, msg); },
    close: async () => { if (!window.isDestroyed()) window.close(); },
  };
}
