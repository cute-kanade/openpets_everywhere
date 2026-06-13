#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "node:zlib";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const catalogPath = join(repoRoot, "web", "public", "plugins", "catalog.v2.json");
const zipDir = join(repoRoot, "web", ".data", "plugin-zips");
const officialDir = join(repoRoot, "plugins", "official");

const useLive = process.argv.includes("--live");
const requireLocalZips = process.argv.includes("--require-local-zips") || !useLive;
const errors = [];

const textDecoder = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  errors.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasTranslationRef(value) {
  return typeof value === "string" && value.includes("$t:");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fetchBytes(url) {
  const requestUrl = new URL(url);
  if (useLive) requestUrl.searchParams.set("openpetsValidate", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const response = await fetch(requestUrl, { redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function loadCatalog() {
  if (useLive) {
    const bytes = await fetchBytes("https://openpets.dev/plugins/catalog.v2.json");
    return JSON.parse(bytes.toString("utf8"));
  }
  return readJson(catalogPath);
}

async function officialPluginIds() {
  try {
    return (await readdir(officialDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function loadZip(entry) {
  if (useLive) return fetchBytes(entry.downloadUrl);
  const path = join(zipDir, `${entry.id}.zip`);
  if (!existsSync(path)) {
    if (requireLocalZips) fail(`${entry.id}: missing local package zip at ${path}; run pnpm plugins:package first.`);
    return undefined;
  }
  return readFile(path);
}

function parseZip(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if ((flags & 0x08) !== 0) throw new Error("ZIP data descriptors are not supported by release validator.");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("ZIP entry exceeds file bounds.");
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = unzipSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${method}.`);
    if (data.length !== uncompressedSize) throw new Error(`ZIP entry size mismatch for ${name}.`);
    files.set(name, data);
    offset = dataEnd;
  }
  return files;
}

function flattenLocale(value, prefix = "") {
  const out = {};
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isRecord(entry)) Object.assign(out, flattenLocale(entry, fullKey));
    else if (typeof entry === "string") out[fullKey] = entry;
  }
  return out;
}

function resolvePluginText(catalog, value) {
  if (typeof value !== "string" || !value.startsWith("$t:")) return value;
  return catalog[value.slice(3)];
}

function assertNoTranslationRefs(path, value) {
  if (hasTranslationRef(value)) fail(`${path}: unresolved translation ref ${value}`);
}

function validateCatalog(catalog, expectedIds) {
  if (!isRecord(catalog)) fail("Plugin catalog must be an object.");
  if (!Array.isArray(catalog.plugins)) fail("Plugin catalog must contain a plugins array.");
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  const ids = plugins.map((plugin) => plugin?.id).sort((a, b) => String(a).localeCompare(String(b)));
  for (const id of expectedIds) if (!ids.includes(id)) fail(`catalog: missing official plugin ${id}`);
  for (const plugin of plugins) {
    if (!isRecord(plugin)) { fail("catalog: plugin entry must be an object"); continue; }
    assertNoTranslationRefs(`${plugin.id}.name`, plugin.name);
    assertNoTranslationRefs(`${plugin.id}.description`, plugin.description);
    if (plugin.runtime !== "javascript") fail(`${plugin.id}: current release catalog must only expose JavaScript SDK plugins.`);
    if (!/^3\./.test(String(plugin.sdkVersion ?? ""))) fail(`${plugin.id}: expected SDK v3 catalog entry.`);
    if (typeof plugin.downloadUrl !== "string" || !plugin.downloadUrl.startsWith("https://zip.openpets.dev/plugins/")) fail(`${plugin.id}: invalid plugin ZIP URL.`);
    if (!/^[0-9a-f]{64}$/.test(String(plugin.sha256 ?? ""))) fail(`${plugin.id}: invalid sha256.`);
  }
  return plugins;
}

function validateManifestAgainstCatalog(entry, manifest, localeCatalog, files) {
  if (manifest.id !== entry.id) fail(`${entry.id}: ZIP manifest id mismatch (${manifest.id}).`);
  if (manifest.version !== entry.version) fail(`${entry.id}: ZIP manifest version mismatch.`);
  if (manifest.runtime !== "javascript") fail(`${entry.id}: ZIP manifest must be JavaScript runtime.`);
  if (manifest.manifestVersion !== 3) fail(`${entry.id}: ZIP manifest must use manifestVersion 3.`);
  if (!/^3\./.test(String(manifest.sdkVersion ?? ""))) fail(`${entry.id}: ZIP manifest must use SDK v3.`);
  if (typeof manifest.entry !== "string" || !files.has(manifest.entry)) fail(`${entry.id}: ZIP is missing entry file ${manifest.entry}.`);

  const resolvedName = resolvePluginText(localeCatalog, manifest.name);
  const resolvedDescription = resolvePluginText(localeCatalog, manifest.description);
  if (!resolvedName || hasTranslationRef(resolvedName)) fail(`${entry.id}: manifest name cannot be resolved from locales/en.json.`);
  if (!resolvedDescription || hasTranslationRef(resolvedDescription)) fail(`${entry.id}: manifest description cannot be resolved from locales/en.json.`);
  if (entry.name !== resolvedName) fail(`${entry.id}: catalog name must be resolved user-facing text (${resolvedName ?? "missing"}).`);
  if (entry.description !== resolvedDescription) fail(`${entry.id}: catalog description must be resolved user-facing text.`);

  for (const [kind, group] of Object.entries(manifest.assets ?? {})) {
    if (!isRecord(group)) continue;
    for (const [name, relPath] of Object.entries(group)) {
      if (typeof relPath !== "string" || !files.has(relPath)) fail(`${entry.id}: missing declared ${kind} asset ${name} at ${relPath}.`);
    }
  }
}

async function validatePluginPackage(entry) {
  let zip;
  try {
    zip = await loadZip(entry);
  } catch (error) {
    fail(`${entry.id}: ZIP unavailable at ${entry.downloadUrl}: ${error.message}`);
    return;
  }
  if (!zip) return;
  const sha = createHash("sha256").update(zip).digest("hex");
  if (sha !== entry.sha256) fail(`${entry.id}: ZIP sha256 mismatch; catalog=${entry.sha256} actual=${sha}`);

  let files;
  try {
    files = parseZip(zip);
  } catch (error) {
    fail(`${entry.id}: invalid ZIP package: ${error.message}`);
    return;
  }

  if (!files.has("openpets.plugin.json")) {
    fail(`${entry.id}: ZIP missing openpets.plugin.json.`);
    return;
  }
  if (!files.has("locales/en.json")) fail(`${entry.id}: ZIP missing locales/en.json; Control Center cannot resolve plugin $t: metadata after install.`);

  let manifest;
  let localeCatalog = {};
  try {
    manifest = JSON.parse(textDecoder.decode(files.get("openpets.plugin.json")));
  } catch (error) {
    fail(`${entry.id}: invalid manifest JSON in ZIP: ${error.message}`);
    return;
  }
  try {
    localeCatalog = flattenLocale(JSON.parse(textDecoder.decode(files.get("locales/en.json") ?? Buffer.from("{}"))));
  } catch (error) {
    fail(`${entry.id}: invalid locales/en.json in ZIP: ${error.message}`);
  }
  validateManifestAgainstCatalog(entry, manifest, localeCatalog, files);
}

const expectedIds = await officialPluginIds();
const catalog = await loadCatalog();
const plugins = validateCatalog(catalog, expectedIds);
for (const entry of plugins) await validatePluginPackage(entry);

if (errors.length > 0) {
  console.error(`Plugin release validation failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Plugin release validation passed for ${plugins.length} plugin${plugins.length === 1 ? "" : "s"}${useLive ? " (live)" : ""}.`);
