import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windowsSource = readFileSync(resolve(desktopRoot, "src/windows.ts"), "utf8");
const preloadSource = readFileSync(resolve(desktopRoot, "preload.cjs"), "utf8");

assert.match(windowsSource, /kind === "plugins"[\s\S]*preload: getPreloadPath\(\)/);
assert.match(windowsSource, /assertAllowedSender\(event, \["plugins"\]\)/);
assert.match(windowsSource, /openpets:plugins-snapshot/);
assert.match(windowsSource, /openpets:plugins-save-config/);
assert.match(windowsSource, /openpets:plugins-load-local/);
assert.match(windowsSource, /openpets:plugins-catalog-snapshot/);
assert.match(windowsSource, /openpets:plugins-install-catalog/);
assert.match(windowsSource, /openpets:plugins-update-catalog/);
assert.match(windowsSource, /openpets:plugins-uninstall/);
assert.match(windowsSource, /openpets:plugins-load-local[\s\S]*assertAllowedSender\(event, \["plugins"\]\)/);
assert.match(preloadSource, /contextBridge\.exposeInMainWorld\("openpetsPlugins", pluginsApi\)/);
assert.match(preloadSource, /snapshot: \(\) => ipcRenderer\.invoke\("openpets:plugins-snapshot"\)/);
assert.match(preloadSource, /loadLocal: \(\) => ipcRenderer\.invoke\("openpets:plugins-load-local"\)/);
assert.match(preloadSource, /catalogSnapshot: \(refresh\) => ipcRenderer\.invoke\("openpets:plugins-catalog-snapshot", refresh\)/);
assert.match(preloadSource, /installCatalog: \(id\) => ipcRenderer\.invoke\("openpets:plugins-install-catalog", id\)/);
assert.match(preloadSource, /updateCatalog: \(id\) => ipcRenderer\.invoke\("openpets:plugins-update-catalog", id\)/);
assert.match(preloadSource, /uninstall: \(id\) => ipcRenderer\.invoke\("openpets:plugins-uninstall", id\)/);
assert.doesNotMatch(preloadSource, /plugins-load-local",\s*[^)]/);
assert.doesNotMatch(preloadSource, /manifestPath/);
assert.doesNotMatch(preloadSource, /installPath/);
assert.doesNotMatch(preloadSource, /openpets:plugins-install-catalog",\s*[^)]+,\s*[^)]/);

console.error("Plugin UI static validation passed.");
