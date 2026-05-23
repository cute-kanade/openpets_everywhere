import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windowsSource = readFileSync(resolve(desktopRoot, "src/windows.ts"), "utf8");
const preloadSource = readFileSync(resolve(desktopRoot, "preload.cjs"), "utf8");
const controlCenterPreloadSource = readFileSync(resolve(desktopRoot, "control-center-preload.cjs"), "utf8");
const controlCenterRendererSource = readFileSync(resolve(desktopRoot, "src/renderer/src/main.tsx"), "utf8");
const jsHostSource = readFileSync(resolve(desktopRoot, "src/plugin-js-host.ts"), "utf8");
const pluginSdkPreloadSource = readFileSync(resolve(desktopRoot, "plugin-sdk-preload.cjs"), "utf8");

assert.match(windowsSource, /kind === "plugins"[\s\S]*preload: getPreloadPath\(\)/);
assert.match(windowsSource, /assertAllowedSender\(event, \["plugins", "control-center"\]\)/);
assert.match(windowsSource, /openpets:plugins-snapshot/);
assert.match(windowsSource, /openpets:plugins-save-config/);
assert.match(windowsSource, /openpets:plugins-load-local/);
assert.match(windowsSource, /openpets:plugins-catalog-snapshot/);
assert.match(windowsSource, /openpets:plugins-install-catalog/);
assert.match(windowsSource, /openpets:plugins-update-catalog/);
assert.match(windowsSource, /openpets:plugins-uninstall/);
assert.match(windowsSource, /openpets:plugins-load-local[\s\S]*assertAllowedSender\(event, \["plugins", "control-center"\]\)/);
assert.match(preloadSource, /contextBridge\.exposeInMainWorld\("openpetsPlugins", pluginsApi\)/);
assert.match(preloadSource, /snapshot: \(\) => ipcRenderer\.invoke\("openpets:plugins-snapshot"\)/);
assert.match(preloadSource, /loadLocal: \(\) => ipcRenderer\.invoke\("openpets:plugins-load-local"\)/);
assert.match(preloadSource, /catalogSnapshot: \(refresh\) => ipcRenderer\.invoke\("openpets:plugins-catalog-snapshot", refresh\)/);
assert.match(preloadSource, /installCatalog: \(id\) => ipcRenderer\.invoke\("openpets:plugins-install-catalog", id\)/);
assert.match(preloadSource, /updateCatalog: \(id\) => ipcRenderer\.invoke\("openpets:plugins-update-catalog", id\)/);
assert.match(preloadSource, /uninstall: \(id\) => ipcRenderer\.invoke\("openpets:plugins-uninstall", id\)/);
assert.match(controlCenterPreloadSource, /getPluginsSnapshot: \(\) => ipcRenderer\.invoke\("openpets:plugins-snapshot"\)/);
assert.match(controlCenterPreloadSource, /getPluginCatalogSnapshot: \(refresh\) => ipcRenderer\.invoke\("openpets:plugins-catalog-snapshot", refresh\)/);
assert.match(controlCenterPreloadSource, /setPluginEnabled: \(id, enabled\) => ipcRenderer\.invoke\("openpets:plugins-set-enabled", id, enabled\)/);
assert.match(controlCenterPreloadSource, /savePluginConfig: \(id, config\) => ipcRenderer\.invoke\("openpets:plugins-save-config", id, config\)/);
assert.match(controlCenterPreloadSource, /loadLocalPlugin: \(\) => ipcRenderer\.invoke\("openpets:plugins-load-local"\)/);
assert.match(controlCenterPreloadSource, /installCatalogPlugin: \(id\) => ipcRenderer\.invoke\("openpets:plugins-install-catalog", id\)/);
assert.match(controlCenterPreloadSource, /uninstallPlugin: \(id\) => ipcRenderer\.invoke\("openpets:plugins-uninstall", id\)/);
assert.match(controlCenterRendererSource, /function PluginsView\(\)/);
assert.match(controlCenterRendererSource, /currentRoute === "plugins"[\s\S]*<PluginsView \/>/);
assert.match(controlCenterRendererSource, /materializeListItemDefaults/);
assert.match(controlCenterRendererSource, /updateCatalogEntry[\s\S]*api\.updateCatalogPlugin/);
assert.match(controlCenterRendererSource, /installed\.source === "catalog"[\s\S]*updateCatalogEntry/);
assert.doesNotMatch(preloadSource, /plugins-load-local",\s*[^)]/);
assert.doesNotMatch(controlCenterPreloadSource, /plugins-load-local",\s*[^)]/);
assert.doesNotMatch(preloadSource, /manifestPath/);
assert.doesNotMatch(preloadSource, /installPath/);
assert.doesNotMatch(controlCenterPreloadSource, /manifestPath/);
assert.doesNotMatch(controlCenterPreloadSource, /installPath/);
assert.doesNotMatch(preloadSource, /openpets:plugins-install-catalog",\s*[^)]+,\s*[^)]/);

// Ensure no plugin tabs remain
assert.doesNotMatch(preloadSource, /plugin-tabs/);
assert.doesNotMatch(preloadSource, /plugin-tab-content/);

// Ensure developer load button is bound
assert.match(preloadSource, /loadLocalBtn\.onclick/);

// Ensure option object label/value handling exists
assert.match(preloadSource, /opt\.value/);
assert.match(preloadSource, /opt\.label/);

// Ensure list item collection avoids nested data loss
assert.match(preloadSource, /dataset\.schemaKey/);
assert.match(preloadSource, /Array\.from\(container\.children\)/);

assert.match(jsHostSource, /OpenPetsPlugin[\s\S]*register/);
assert.match(jsHostSource, /start\(sdk\)/);
assert.match(jsHostSource, /__openPetsRegisteredPlugin[\s\S]*stop/);
assert.match(jsHostSource, /preload: getPluginSdkPreloadPath\(\)/);
assert.match(pluginSdkPreloadSource, /contextBridge\.exposeInMainWorld\("__openPetsSdk", sdk\)/);
assert.match(pluginSdkPreloadSource, /speak: \(message\) => call\("pet\.speak", \[message\]\)/);
assert.match(pluginSdkPreloadSource, /register: \(command, handler\) => call\("commands\.register"/);

console.error("Plugin UI static validation passed.");
