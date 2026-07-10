import { promises as fs } from "node:fs";
import sharp from "sharp";

import { isPathContained, parsePluginSpriteRequest, resolveDeclaredAssetPath } from "./plugin-assets.js";
import { readSafePluginManifest } from "./plugin-manifest-reader.js";

type PluginServiceLookup = { allowedPluginRoots: readonly string[]; stateStore: { getRecord(id: string): { id: string; version: string; enabled: boolean; installPath: string; manifestPath: string } | undefined } };
type ProtocolRegistry = { handle(scheme: string, handler: (request: { url: string; method: string }) => Promise<Response>): void };

/** Register the sole renderer-visible plugin asset route. */
export function registerPluginAssetProtocol(registry: ProtocolRegistry, getService: () => PluginServiceLookup, realpathFn: (path: string) => Promise<string> = (path) => fs.realpath(path)): void {
  const cache = new Map<string, Buffer>();
  registry.handle("openpets-plugin-asset", async (request) => {
    try {
      const parsed = parsePluginSpriteRequest(request.url, request.method);
      if (!parsed) return new Response(null, { status: request.method === "GET" || request.method === "HEAD" ? 404 : 405 });
      const { pluginId, assetName, version } = parsed;
      const service = getService();
      const record = service.stateStore.getRecord(pluginId);
      if (!record || !record.enabled || record.id !== pluginId || record.version !== version) return new Response(null, { status: 404 });
      const manifest = await readSafePluginManifest({ installPath: record.installPath, manifestPath: record.manifestPath, allowedPluginRoots: service.allowedPluginRoots, expectedId: pluginId, expectedVersion: version });
      if (manifest.runtime !== "javascript" || manifest.manifestVersion !== 3 || !manifest.assets?.sprites?.[assetName]) return new Response(null, { status: 404 });
      const assetPath = resolveDeclaredAssetPath(manifest, record.installPath, "sprites", assetName);
      const realRoot = await realpathFn(record.installPath);
      const realAsset = await realpathFn(assetPath);
      if (!isPathContained(realRoot, realAsset)) return new Response(null, { status: 404 });
      const key = `${pluginId}:${assetName}:${version}`;
      let bytes = cache.get(key);
      if (!bytes) {
        const info = await fs.stat(realAsset);
        if (!info.isFile() || info.size <= 0 || info.size > 5 * 1024 * 1024) return new Response(null, { status: 404 });
        bytes = await fs.readFile(realAsset);
        const sprite = manifest.assets.sprites[assetName]!;
        const metadata = await sharp(bytes, { limitInputPixels: 4_194_304, animated: false }).metadata();
        if (metadata.format !== "webp" || metadata.width !== sprite.frameWidth * sprite.frames || metadata.height !== sprite.frameHeight) return new Response(null, { status: 404 });
        cache.set(key, bytes);
      }
      return new Response(request.method === "HEAD" ? null : bytes as unknown as never, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" } });
    } catch { return new Response(null, { status: 404 }); }
  });
}
