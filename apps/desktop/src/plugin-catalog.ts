import { validatePluginCatalog, type PluginCatalog, type PluginCatalogEntry } from "./plugin-catalog-validation.js";

export const pluginCatalogUrl = "https://openpets.dev/plugins/catalog.v1.json";
const maxCatalogBytes = 2 * 1024 * 1024;
const catalogTimeoutMs = 15_000;
let cached: PluginCatalog | null = null;

export type PluginCatalogOptions = { readonly refresh?: boolean; readonly fetchImpl?: typeof fetch; readonly url?: string };

export async function getPluginCatalog(options: PluginCatalogOptions = {}): Promise<PluginCatalog> {
  if (cached && !options.refresh) return cached;
  const url = options.url ?? pluginCatalogUrl;
  const fetcher = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), catalogTimeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal, redirect: "error", credentials: "omit" });
    if (response.url && response.url !== url) throw new Error("Plugin catalog final URL changed.");
    if (!response.ok) throw new Error(`Plugin catalog fetch failed with HTTP ${response.status}.`);
    const text = (await readLimitedResponse(response, maxCatalogBytes)).toString("utf8");
    cached = validatePluginCatalog(JSON.parse(text) as unknown);
    return cached;
  } finally { clearTimeout(timeout); }
}

export async function getCatalogPlugin(id: string, options: PluginCatalogOptions = {}): Promise<PluginCatalogEntry> {
  const catalog = await getPluginCatalog(options);
  const plugin = catalog.plugins.find((entry) => entry.id === id);
  if (!plugin) throw new Error("Plugin is not in the catalog.");
  return plugin;
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Plugin catalog response body is unavailable.");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) throw new Error("Plugin catalog response is too large."); chunks.push(value); }
  return Buffer.concat(chunks, total);
}
