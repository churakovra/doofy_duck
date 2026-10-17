import { Assets, type Texture } from 'pixi.js';
import type { WardrobeAssetPaths } from './wardrobe';

export type WardrobeTextures = Partial<Record<keyof WardrobeAssetPaths, Texture>>;
export type TextureLoader = (path: string) => Promise<Texture>;

export async function loadWardrobeTextures(
  paths: WardrobeAssetPaths | undefined,
  loader: TextureLoader = (path) => Assets.load<Texture>(path),
): Promise<WardrobeTextures> {
  const entries = Object.entries(paths ?? {}) as [keyof WardrobeAssetPaths, string][];
  const results = await Promise.all(entries.map(async ([key, path]) => {
    try { return [key, await loader(path)] as const; }
    catch { return undefined; }
  }));
  return Object.fromEntries(results.filter((result): result is readonly [keyof WardrobeAssetPaths, Texture] => result !== undefined));
}

/** Ignores completion from older selections and from an unmounted renderer. */
export function createWardrobeAssetController(loader: TextureLoader = (path) => Assets.load<Texture>(path)) {
  let revision = 0;
  let disposed = false;
  return {
    async load(paths: WardrobeAssetPaths | undefined, onReady: (textures: WardrobeTextures) => void) {
      const requestRevision = ++revision;
      const textures = await loadWardrobeTextures(paths, loader);
      if (!disposed && requestRevision === revision) onReady(textures);
    },
    dispose() { disposed = true; revision += 1; },
  };
}
