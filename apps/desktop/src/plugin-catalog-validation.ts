import { canonicalizePluginPermissions, type PluginPermission } from "./plugin-manifest.js";

export type PluginCatalogEntry = { readonly id: string; readonly name: string; readonly version: string; readonly description: string; readonly runtime: "declarative"; readonly permissions: readonly PluginPermission[]; readonly downloadUrl: string; readonly sha256: string; readonly minOpenPetsVersion?: string };
export type PluginCatalog = { readonly version: 1; readonly generatedAt: string; readonly plugins: readonly PluginCatalogEntry[] };

const catalogFields = new Set(["version", "generatedAt", "plugins"]);
const entryFields = new Set(["id", "name", "version", "description", "runtime", "permissions", "downloadUrl", "sha256", "minOpenPetsVersion"]);
const idPattern = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const shaPattern = /^[0-9a-f]{64}$/;

export function validatePluginCatalog(input: unknown): PluginCatalog {
  if (!isRecord(input)) throw new Error("Plugin catalog must be an object.");
  rejectUnknown(input, catalogFields, "catalog");
  if (input.version !== 1) throw new Error("Plugin catalog version must be 1.");
  requireString(input.generatedAt, "generatedAt", 1, 128);
  if (!Array.isArray(input.plugins)) throw new Error("Plugin catalog plugins must be an array.");
  if (input.plugins.length > 1000) throw new Error("Plugin catalog contains too many plugins.");
  const seen = new Set<string>();
  const plugins = input.plugins.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Plugin catalog entry ${index} must be an object.`);
    rejectUnknown(entry, entryFields, `plugins[${index}]`);
    const id = requireString(entry.id, "id", 3, 64, idPattern);
    if (seen.has(id)) throw new Error(`Duplicate plugin id: ${id}`);
    seen.add(id);
    const permissions = canonicalizePluginPermissions(entry.permissions);
    return { id, name: requireString(entry.name, "name", 1, 120), version: requireString(entry.version, "version", 1, 80, versionPattern), description: requireString(entry.description, "description", 0, 1000), runtime: requireRuntime(entry.runtime), permissions, downloadUrl: requireString(entry.downloadUrl, "downloadUrl", 1, 2048), sha256: requireString(entry.sha256, "sha256", 64, 64, shaPattern), minOpenPetsVersion: entry.minOpenPetsVersion === undefined ? undefined : requireString(entry.minOpenPetsVersion, "minOpenPetsVersion", 1, 80, versionPattern) };
  });
  return { version: 1, generatedAt: String(input.generatedAt), plugins };
}

function requireRuntime(value: unknown): "declarative" { if (value !== "declarative") throw new Error('Plugin runtime must be "declarative".'); return value; }
function requireString(value: unknown, name: string, min: number, max: number, pattern?: RegExp): string { if (typeof value !== "string" || value.length < min || value.length > max || (min > 0 && value.trim() === "")) throw new Error(`Invalid plugin catalog ${name}.`); if (pattern && !pattern.test(value)) throw new Error(`Invalid plugin catalog ${name}.`); return value; }
function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, path: string): void { for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`Unknown field ${path}.${key}.`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
