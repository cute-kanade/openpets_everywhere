import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windowsSource = readFileSync(resolve(desktopRoot, "src/windows.ts"), "utf8");
const controlCenterPreloadSource = readFileSync(resolve(desktopRoot, "control-center-preload.cjs"), "utf8");
const controlCenterRendererSource = readFileSync(resolve(desktopRoot, "src/renderer/src/main.tsx"), "utf8");
const jsHostSource = readFileSync(resolve(desktopRoot, "src/plugin-js-host.ts"), "utf8");
const pluginSdkPreloadSource = readFileSync(resolve(desktopRoot, "plugin-sdk-preload.cjs"), "utf8");

assert.doesNotMatch(windowsSource, /openTaskWindow|TaskWindowKind|createPluginsHtml|getPreloadPath|"preload\.cjs"/);
assert.match(windowsSource, /assertAllowedSender\(event, \["control-center"\]\)/);
assert.match(windowsSource, /openpets:plugins-snapshot/);
assert.match(windowsSource, /openpets:plugins-save-config/);
assert.match(windowsSource, /openpets:plugins-load-local/);
assert.match(windowsSource, /openpets:plugins-catalog-snapshot/);
assert.match(windowsSource, /openpets:plugins-install-catalog/);
assert.match(windowsSource, /openpets:plugins-update-catalog/);
assert.match(windowsSource, /openpets:plugins-uninstall/);
assert.match(windowsSource, /openpets:plugins-load-local[\s\S]*assertAllowedSender\(event, \["control-center"\]\)/);

assert.match(controlCenterPreloadSource, /getPluginsSnapshot: \(\) => ipcRenderer\.invoke\("openpets:plugins-snapshot"\)/);
assert.match(controlCenterPreloadSource, /getPluginCatalogSnapshot: \(refresh\) => ipcRenderer\.invoke\("openpets:plugins-catalog-snapshot", refresh\)/);
assert.match(controlCenterPreloadSource, /setPluginEnabled: \(id, enabled\) => ipcRenderer\.invoke\("openpets:plugins-set-enabled", id, enabled\)/);
assert.match(controlCenterPreloadSource, /savePluginConfig: \(id, config\) => ipcRenderer\.invoke\("openpets:plugins-save-config", id, config\)/);
assert.match(controlCenterPreloadSource, /loadLocalPlugin: \(\) => ipcRenderer\.invoke\("openpets:plugins-load-local"\)/);
assert.match(controlCenterPreloadSource, /installCatalogPlugin: \(id\) => ipcRenderer\.invoke\("openpets:plugins-install-catalog", id\)/);
assert.match(controlCenterPreloadSource, /uninstallPlugin: \(id\) => ipcRenderer\.invoke\("openpets:plugins-uninstall", id\)/);
assert.doesNotMatch(controlCenterPreloadSource, /onboarding/i);
assert.doesNotMatch(controlCenterPreloadSource, /plugins-load-local",\s*[^)]/);
assert.doesNotMatch(controlCenterPreloadSource, /manifestPath/);
assert.doesNotMatch(controlCenterPreloadSource, /installPath/);
assert.doesNotMatch(controlCenterPreloadSource, /openpets:plugins-install-catalog",\s*[^)]+,\s*[^)]/);

assert.match(controlCenterRendererSource, /function PluginsView\(\)/);
assert.match(controlCenterRendererSource, /currentRoute === "plugins"[\s\S]*<PluginsView \/>/);
assert.doesNotMatch(controlCenterRendererSource, /OnboardingView|currentRoute === "onboarding"/);
assert.match(controlCenterRendererSource, /materializeListItemDefaults/);
assert.match(controlCenterRendererSource, /updateCatalogEntry[\s\S]*api\.updateCatalogPlugin/);
assert.match(controlCenterRendererSource, /installed\.source === "catalog"[\s\S]*updateCatalogEntry/);

assert.match(jsHostSource, /OpenPetsPlugin[\s\S]*register/);
assert.match(jsHostSource, /start\(sdk\)/);
assert.match(jsHostSource, /__openPetsRegisteredPlugin[\s\S]*stop/);
assert.match(jsHostSource, /preload: getPluginSdkPreloadPath\(\)/);
assert.match(pluginSdkPreloadSource, /contextBridge\.exposeInMainWorld\("__openPetsSdk", sdk\)/);
assert.match(pluginSdkPreloadSource, /speak: \(spec\) => call\("pet\.speak", \[petId, spec\]\)/);
assert.match(pluginSdkPreloadSource, /register: \(command, handler\) => call\("commands\.register"/);
// SDK v3 namespaces are exposed to the plugin sandbox.
assert.match(pluginSdkPreloadSource, /bubble: \(spec\) => call\("ui\.bubble", \[spec\]\)/);
assert.match(pluginSdkPreloadSource, /on: \(event, fn\) => subscription\("events\.on", "events\.off"/);
assert.match(pluginSdkPreloadSource, /publish: \(topic, payload\) => call\("bus\.publish", \[topic, payload\]\)/);
// Plugin platform settings are reachable from the Control Center.
assert.match(windowsSource, /openpets:get-lan-status/);
assert.match(controlCenterPreloadSource, /getLanStatus: \(\) => ipcRenderer\.invoke\("openpets:get-lan-status"\)/);
assert.match(controlCenterRendererSource, /function LanSettingsPanel/);
assert.match(controlCenterRendererSource, /settings\.nav\.lan/);
assert.match(controlCenterRendererSource, /settings\.lan\.topologyWarnings/);
assert.match(windowsSource, /openpets:plugin-platform-settings-get/);
assert.match(windowsSource, /openpets:plugins-inspector/);
assert.match(controlCenterPreloadSource, /getPluginPlatformSettings: \(\) => ipcRenderer\.invoke\("openpets:plugin-platform-settings-get"\)/);

console.error("Plugin Control Center static validation passed.");
