import { promises as fs } from "node:fs";
import { join } from "node:path";

import { pluginAssetMaxBytes, pluginPanelMaxBytes, type OpenPetsJavascriptPluginManifest, type PluginAssetKind } from "./plugin-manifest.js";

/** One file a v3 manifest declares (asset or panel page). */
export type DeclaredPluginFile = {
  readonly kind: PluginAssetKind | "panel";
  readonly name: string;
  readonly relPath: string;
  readonly maxBytes: number;
};

/** All bundled files a v3 plugin declares beyond manifest + entry. */
export function collectDeclaredPluginFiles(manifest: OpenPetsJavascriptPluginManifest): DeclaredPluginFile[] {
  if (manifest.manifestVersion !== 3) return [];
  const files: DeclaredPluginFile[] = [];
  const kinds: PluginAssetKind[] = ["icons", "images", "svgs", "sprites", "sounds"];
  for (const kind of kinds) {
    for (const [name, relPath] of Object.entries(manifest.assets?.[kind] ?? {})) {
      files.push({ kind, name, relPath, maxBytes: pluginAssetMaxBytes[kind] });
    }
  }
  for (const [name, relPath] of Object.entries(manifest.panels ?? {})) {
    files.push({ kind: "panel", name, relPath, maxBytes: pluginPanelMaxBytes });
  }
  return files;
}

/**
 * Install-time SVG sanitization (§6): strip script, foreignObject, event
 * handler attributes, and external/javascript references. The output is the
 * only SVG ever handed to a pet window.
 */
export function sanitizeSvgText(svg: string): string {
  let out = svg;
  // Drop processing risks wholesale.
  out = out.replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, "");
  out = out.replace(/<foreignObject\b[\s\S]*?(?:<\/foreignObject\s*>|$)/gi, "");
  out = out.replace(/<!ENTITY[\s\S]*?>/gi, "");
  // Strip on* event handler attributes.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  // Strip external or javascript hrefs; keep same-document fragment refs.
  out = out.replace(/\s(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, "");
  out = out.replace(/\s(href|xlink:href)\s*=\s*'(?!#)[^']*'/gi, "");
  // No external style imports or url() loads.
  out = out.replace(/@import[^;]*;/gi, "");
  out = out.replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, "none");
  return out;
}

const panelCsp = "default-src 'none'; script-src 'unsafe-inline' file:; style-src 'unsafe-inline' file:; img-src file: data:; media-src file: data:; font-src file: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

/**
 * Inject the panel sandbox CSP into plugin panel HTML at install time so the
 * loaded file: document is locked down even before the session-level request
 * filter applies.
 */
export function injectPanelCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${panelCsp}">`;
  const withoutExisting = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, "");
  if (/<head[^>]*>/i.test(withoutExisting)) return withoutExisting.replace(/<head[^>]*>/i, (match) => `${match}${meta}`);
  if (/<html[^>]*>/i.test(withoutExisting)) return withoutExisting.replace(/<html[^>]*>/i, (match) => `${match}<head>${meta}</head>`);
  return `${meta}${withoutExisting}`;
}

/** Validate and transform a declared file's bytes before publishing. */
export function preparePluginFileBytes(file: DeclaredPluginFile, bytes: Buffer): Buffer {
  if (bytes.byteLength > file.maxBytes) throw new Error(`Plugin ${file.kind} file is too large: ${file.relPath}`);
  if (file.kind === "svgs" || (file.kind === "icons" && file.relPath.toLowerCase().endsWith(".svg"))) {
    return Buffer.from(sanitizeSvgText(bytes.toString("utf8")), "utf8");
  }
  if (file.kind === "panel") {
    return Buffer.from(injectPanelCsp(bytes.toString("utf8")), "utf8");
  }
  return bytes;
}

/** Read all declared files from a plugin source folder, validated and prepared. */
export async function readDeclaredPluginFiles(manifest: OpenPetsJavascriptPluginManifest, realSourceFolder: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const file of collectDeclaredPluginFiles(manifest)) {
    const filePath = join(realSourceFolder, file.relPath);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Plugin declared file is invalid: ${file.relPath}`);
    if (stat.size > file.maxBytes) throw new Error(`Plugin ${file.kind} file is too large: ${file.relPath}`);
    const realPath = await fs.realpath(filePath);
    if (realPath !== filePath) throw new Error(`Plugin declared file is invalid: ${file.relPath}`);
    out.set(file.relPath, preparePluginFileBytes(file, await fs.readFile(filePath)));
  }
  return out;
}

/** Write prepared declared files into a (temp) install directory. */
export async function writeDeclaredPluginFiles(targetDir: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  for (const [relPath, bytes] of files) {
    const filePath = join(targetDir, relPath);
    await fs.mkdir(join(filePath, ".."), { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, bytes, { mode: 0o600 });
  }
}

/** Resolve a declared asset name to its on-disk path inside an install dir. */
export function resolveDeclaredAssetPath(manifest: OpenPetsJavascriptPluginManifest, installPath: string, kind: PluginAssetKind, name: string): string {
  const relPath = manifest.manifestVersion === 3 ? manifest.assets?.[kind]?.[name] : undefined;
  if (!relPath) throw new Error(`Plugin asset is not declared: ${kind}/${name}`);
  return join(installPath, relPath);
}

/** Resolve a declared panel name to its on-disk path inside an install dir. */
export function resolveDeclaredPanelPath(manifest: OpenPetsJavascriptPluginManifest, installPath: string, name: string): string {
  const relPath = manifest.manifestVersion === 3 ? manifest.panels?.[name] : undefined;
  if (!relPath) throw new Error(`Plugin panel is not declared: ${name}`);
  return join(installPath, relPath);
}
