import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import { type PluginCatalogEntry } from "./plugin-catalog-validation.js";
import { defaultMaxPluginManifestBytes, readSafePluginManifest, isUnderPath } from "./plugin-manifest-reader.js";
import { canonicalizePluginPermissions, OPENPETS_PLUGIN_MANIFEST_FILENAME, validatePluginManifest, type OpenPetsPluginManifest } from "./plugin-manifest.js";

const maxZipBytes = 5 * 1024 * 1024;
export type PluginPackageInstall = { readonly manifest: OpenPetsPluginManifest; readonly installPath: string; readonly manifestPath: string };

export async function downloadCatalogPluginZip(entry: PluginCatalogEntry, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  validatePluginZipUrl(entry.downloadUrl);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000);
  try { const response = await fetchImpl(entry.downloadUrl, { signal: controller.signal, redirect: "error", credentials: "omit" }); if (response.url && response.url !== entry.downloadUrl) throw new Error("Plugin ZIP final URL changed."); if (!response.ok) throw new Error(`Plugin ZIP download failed with HTTP ${response.status}.`); const zip = await readLimitedResponse(response, maxZipBytes); if (createHash("sha256").update(zip).digest("hex") !== entry.sha256) throw new Error("Plugin ZIP SHA-256 mismatch."); return zip; }
  finally { clearTimeout(timeout); }
}

export function validatePluginZipUrl(value: string): void { const url = new URL(value); if (url.protocol !== "https:" || url.hostname !== "zip.openpets.dev" || !url.pathname.startsWith("/plugins/") || url.username || url.password || url.port) throw new Error("Plugin ZIP URL is not allowed."); }

export async function readCatalogPluginManifestFromZip(options: { readonly catalogEntry: PluginCatalogEntry; readonly zip: Buffer; readonly maxManifestBytes?: number }): Promise<{ readonly manifest: OpenPetsPluginManifest; readonly manifestText: string }> {
  const text = await readManifestFromZip(options.zip, options.maxManifestBytes ?? defaultMaxPluginManifestBytes);
  const parsed = JSON.parse(text) as unknown; const result = validatePluginManifest(parsed); if (!result.ok) throw new Error("Plugin manifest validation failed.");
  const manifest = result.manifest; assertCatalogConsistency(options.catalogEntry, manifest);
  return { manifest, manifestText: text };
}

export async function installCatalogPluginPackage(options: { readonly userDataPath: string; readonly catalogEntry: PluginCatalogEntry; readonly zip: Buffer; readonly maxManifestBytes?: number }): Promise<PluginPackageInstall> {
  const { manifest, manifestText: text } = await readCatalogPluginManifestFromZip(options);
  const root = join(options.userDataPath, "plugins"); await fs.mkdir(root, { recursive: true }); await assertDir(root);
  const installPath = join(root, manifest.id); const manifestPath = join(installPath, OPENPETS_PLUGIN_MANIFEST_FILENAME); const tempManifestPath = join(root, `.tmp-${manifest.id}-${process.pid}-${Date.now()}-${OPENPETS_PLUGIN_MANIFEST_FILENAME}`);
  try {
    await ensureWritableInstallDirectory(installPath, manifestPath);
    await fs.writeFile(tempManifestPath, text, { mode: 0o600 });
    await fs.rename(tempManifestPath, manifestPath);
  } catch (e) { await fs.rm(tempManifestPath, { force: true }); throw e; }
  const copied = await readSafePluginManifest({ installPath, manifestPath, allowedPluginRoots: [root], maxManifestBytes: options.maxManifestBytes, expectedId: manifest.id, expectedVersion: manifest.version });
  return { manifest: copied, installPath, manifestPath };
}

export async function resolveSafePluginInstallDir(userDataPath: string, id: string, installPath: string, source: "catalog" | "local"): Promise<string> { const root = join(userDataPath, source === "catalog" ? "plugins" : "plugins-dev"); await assertDir(root); const stat = await fs.lstat(installPath); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Plugin install directory is invalid."); const realRoot = await fs.realpath(root); const realInstall = await fs.realpath(installPath); if (!isUnderPath(realInstall, realRoot) || realInstall !== join(realRoot, id)) throw new Error("Refusing to delete unexpected plugin directory."); return realInstall; }

export async function safeDeletePluginInstallDir(userDataPath: string, id: string, installPath: string, source: "catalog" | "local"): Promise<void> { const realInstall = await resolveSafePluginInstallDir(userDataPath, id, installPath, source); await fs.rm(realInstall, { recursive: true, force: true }); }

async function ensureWritableInstallDirectory(installPath: string, manifestPath: string): Promise<void> { try { await assertDir(installPath); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ENOENT") throw error; await fs.mkdir(installPath, { recursive: false, mode: 0o700 }); await assertDir(installPath); } try { const manifestStat = await fs.lstat(manifestPath); if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Plugin install manifest is invalid."); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ENOENT") throw error; } }

function assertCatalogConsistency(entry: PluginCatalogEntry, manifest: OpenPetsPluginManifest): void { const entryPermissions = canonicalizePluginPermissions(entry.permissions); const manifestPermissions = canonicalizePluginPermissions(manifest.permissions); if (entry.id !== manifest.id || entry.version !== manifest.version || entry.name !== manifest.name || entry.runtime !== manifest.runtime || entryPermissions.join("\0") !== manifestPermissions.join("\0")) throw new Error("Plugin manifest does not match catalog entry."); }
async function readManifestFromZip(zip: Buffer, maxBytes: number): Promise<string> { const zipFile = await new Promise<ZipFile>((res, rej) => yauzl.fromBuffer(zip, { lazyEntries: true, validateEntrySizes: true }, (e, z) => e || !z ? rej(e ?? new Error("Unable to open plugin ZIP.")) : res(z))); let text: string | undefined; await new Promise<void>((resolve, reject) => { zipFile.on("error", reject); zipFile.on("end", resolve); zipFile.on("entry", (entry: Entry) => { try { validateEntry(entry); if (text !== undefined) throw new Error("Plugin ZIP contains duplicate manifest."); if (entry.uncompressedSize > maxBytes) throw new Error("Plugin manifest is too large."); zipFile.openReadStream(entry, (err, stream) => { if (err || !stream) return reject(err ?? new Error("Unable to read plugin manifest.")); const chunks: Buffer[] = []; let total = 0; stream.on("data", (chunk: Buffer) => { total += chunk.length; if (total > maxBytes) { stream.destroy(new Error("Plugin manifest is too large.")); return; } chunks.push(chunk); }); stream.on("error", reject); stream.on("end", () => { text = Buffer.concat(chunks).toString("utf8"); zipFile.readEntry(); }); }); } catch (e) { reject(e); } }); zipFile.readEntry(); }).finally(() => zipFile.close()); if (text === undefined) throw new Error("Plugin ZIP must contain openpets.plugin.json."); return text; }
function validateEntry(entry: Entry): void { if (entry.fileName !== OPENPETS_PLUGIN_MANIFEST_FILENAME) throw new Error("Plugin ZIP must contain exactly one root manifest file."); if (entry.fileName.includes("/") || entry.fileName.includes("\\") || entry.fileName.includes("\0")) throw new Error("Plugin ZIP entry path is invalid."); if (entry.fileName.startsWith("/") || /^[A-Za-z]:/.test(entry.fileName)) throw new Error("Plugin ZIP entry path is invalid."); if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error("Unsupported plugin ZIP entry compression method."); if ((entry.externalFileAttributes >>> 16) === 0o120000 || ((entry.externalFileAttributes >>> 16) & 0o170000) && ((entry.externalFileAttributes >>> 16) & 0o170000) !== 0o100000) throw new Error("Plugin ZIP entry type is unsupported."); if (entry.generalPurposeBitFlag & 0x1) throw new Error("Encrypted plugin ZIP entries are unsupported."); }
async function assertDir(path: string): Promise<void> { const stat = await fs.lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Plugin directory is invalid."); }
async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> { const reader = response.body?.getReader(); if (!reader) throw new Error("Plugin ZIP response body is unavailable."); const chunks: Uint8Array[] = []; let total = 0; while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) throw new Error("Plugin ZIP is too large."); chunks.push(value); } return Buffer.concat(chunks, total); }
