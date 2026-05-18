import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePluginCatalog } from "../src/plugin-catalog-validation.js";
import { installCatalogPluginPackage, safeDeletePluginInstallDir, validatePluginZipUrl } from "../src/plugin-package.js";
import type { OpenPetsPluginManifest } from "../src/plugin-manifest.js";

const manifest: OpenPetsPluginManifest = { manifestVersion: 1, id: "zip-plug", name: "Zip Plug", version: "1.0.0", runtime: "declarative", permissions: ["timer", "pet:speak"], triggers: [{ on: "timer", everyMinutes: 5, actions: [{ type: "pet.speak", message: "hi" }] }] };
const text = JSON.stringify(manifest);
const zip = makeZip("openpets.plugin.json", Buffer.from(text));
const entry = { id: manifest.id, name: manifest.name, version: manifest.version, description: "desc", runtime: "declarative" as const, permissions: manifest.permissions, downloadUrl: "https://zip.openpets.dev/plugins/zip-plug.zip", sha256: createHash("sha256").update(zip).digest("hex") };

validatePluginZipUrl(entry.downloadUrl);
assert.throws(() => validatePluginZipUrl("http://zip.openpets.dev/plugins/x.zip"), /not allowed/);
assert.throws(() => validatePluginZipUrl("https://zip.openpets.dev:444/plugins/x.zip"), /not allowed/);

const userData = mkdtempSync(join(tmpdir(), "openpets-plugin-package-"));
const installed = await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: entry, zip });
assert.equal(installed.manifest.id, manifest.id);
assert.equal(readFileSync(join(userData, "plugins", manifest.id, "openpets.plugin.json"), "utf8"), text);
assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...entry, name: "Other" }, zip }), /does not match/);
assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: entry, zip: makeZip("nested/openpets.plugin.json", Buffer.from(text)) }), /exactly one root manifest/);

const canonicalEntry = validatePluginCatalog({ version: 1, generatedAt: new Date().toISOString(), plugins: [{ ...entry, permissions: ["timer", "pet:speak"] }] }).plugins[0];
await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: canonicalEntry, zip });

const oldText = JSON.stringify({ ...manifest, version: "0.9.0" });
writeFileSync(join(userData, "plugins", manifest.id, "openpets.plugin.json"), oldText, "utf8");
await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: entry, zip });
assert.equal(readFileSync(join(userData, "plugins", manifest.id, "openpets.plugin.json"), "utf8"), text);

const deleteRoot = mkdtempSync(join(tmpdir(), "openpets-plugin-delete-"));
const outside = mkdtempSync(join(tmpdir(), "openpets-plugin-outside-"));
symlinkSync(outside, join(deleteRoot, "plugins"), "dir");
await assert.rejects(() => safeDeletePluginInstallDir(deleteRoot, manifest.id, join(deleteRoot, "plugins", manifest.id), "catalog"), /invalid|unexpected/);

console.error("Plugin package validation passed.");

function makeZip(name: string, data: Buffer): Buffer {
  const nameBuffer = Buffer.from(name); const crc = crc32(data); const now = 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8); local.writeUInt32LE(now, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(now, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  const localPart = Buffer.concat([local, nameBuffer, data]); const centralPart = Buffer.concat([central, nameBuffer]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralPart.length, 12); end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

function crc32(buffer: Buffer): number { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
