import { describe, expect, it } from 'vitest';
import { BACKGROUND_CATALOG, SKIN_CATALOG, createWardrobeCatalog, createWardrobeSession, DEFAULT_EQUIPMENT, resolveEquipmentAppearance, resolveEquipmentAssets, type Equipment, type WardrobeItem, WARDROBE_STORAGE_KEY } from './wardrobe';
import { DEFAULT_APPEARANCE } from './appearance';
import { createWardrobeAssetController, loadWardrobeTextures, type TextureLoader } from './wardrobe-assets';

const imageBackedFixture = Object.freeze({
  body: new URL('./test-assets/duck-body.svg', import.meta.url).href,
  wing: new URL('./test-assets/duck-wing.svg', import.meta.url).href,
  background: new URL('./test-assets/meadow.svg', import.meta.url).href,
});
const imageBackedTestEntry: WardrobeItem = { id: 'test-image', names: { ru: 'Тестовый рисунок', en: 'Test image' }, appearance: DEFAULT_APPEARANCE, image: { body: imageBackedFixture.body, wing: imageBackedFixture.wing } };
const imageBackedWorldEntry: WardrobeItem = { id: 'test-world', names: { ru: 'Тестовый мир', en: 'Test world' }, appearance: DEFAULT_APPEARANCE, image: { background: imageBackedFixture.background } };

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(WARDROBE_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe('wardrobe catalogs and local equipment', () => {
  it('provides three skins and three worlds with bilingual stable IDs', () => {
    expect(SKIN_CATALOG.map(({ id }) => id)).toEqual(['classic', 'mint', 'rose']);
    expect(BACKGROUND_CATALOG.map(({ id }) => id)).toEqual(['meadow', 'dusk', 'winter']);
    for (const entry of [...SKIN_CATALOG, ...BACKGROUND_CATALOG]) {
      expect(entry.names.ru).not.toBe('');
      expect(entry.names.en).not.toBe('');
      expect(entry.appearance).toBeTruthy();
    }
    const combinations = SKIN_CATALOG.flatMap((skin) => BACKGROUND_CATALOG.map((background) => ({ skin, background })));
    expect(combinations).toHaveLength(9);
    for (const { skin, background } of combinations) {
      const combined = resolveEquipmentAppearance({ skinId: skin.id, backgroundId: background.id });
      expect(combined.duck).toEqual(skin.appearance.duck);
      expect(combined.world).toEqual(background.appearance.world);
      expect(combined.collectibles).toBe(DEFAULT_APPEARANCE.collectibles);
    }
  });

  it('rejects duplicate IDs in either catalog', () => {
    expect(() => createWardrobeCatalog([SKIN_CATALOG[0]!, SKIN_CATALOG[0]!], BACKGROUND_CATALOG)).toThrow(/duplicate/i);
    expect(() => createWardrobeCatalog(SKIN_CATALOG, [BACKGROUND_CATALOG[0]!, BACKGROUND_CATALOG[0]!])).toThrow(/duplicate/i);
  });

  it('resolves optional asset paths independently from skin and background catalogs', () => {
    const testCatalog = createWardrobeCatalog([imageBackedTestEntry], [imageBackedWorldEntry]);
    expect(resolveEquipmentAssets({ skinId: 'test-image', backgroundId: 'test-world' }, testCatalog.skins, testCatalog.backgrounds)).toEqual(imageBackedFixture);
    expect(resolveEquipmentAssets(DEFAULT_EQUIPMENT)).toBeUndefined();
  });

  it('loads current equipment, applies a draft, cancels drafts, and reloads persisted IDs', () => {
    const storage = memoryStorage();
    const session = createWardrobeSession(storage);
    expect(session.equipped).toEqual({ skinId: 'classic', backgroundId: 'meadow' });
    const draft: Equipment = { skinId: 'rose', backgroundId: 'winter' };
    session.apply(draft);
    expect(session.equipped).toEqual(draft);
    expect(JSON.parse(storage.values.get(WARDROBE_STORAGE_KEY)!)).toEqual({ version: 1, equipment: draft });
    expect(createWardrobeSession(storage).equipped).toEqual(draft);
    session.cancel({ skinId: 'mint', backgroundId: 'dusk' });
    expect(session.equipped).toEqual(draft);
  });

  it.each([
    '{',
    JSON.stringify({ version: 2, equipment: { skinId: 'rose', backgroundId: 'winter' } }),
    JSON.stringify({ version: 1, equipment: null }),
  ])('defaults malformed records safely (%s)', (record) => {
    expect(createWardrobeSession(memoryStorage(record)).equipped).toEqual({ skinId: 'classic', backgroundId: 'meadow' });
  });

  it('falls back unknown skin and world IDs independently', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, equipment: { skinId: 'unknown', backgroundId: 'winter' } }));
    expect(createWardrobeSession(storage).equipped).toEqual({ skinId: 'classic', backgroundId: 'winter' });
    storage.values.set(WARDROBE_STORAGE_KEY, JSON.stringify({ version: 1, equipment: { skinId: 'rose', backgroundId: 'unknown' } }));
    expect(createWardrobeSession(storage).equipped).toEqual({ skinId: 'rose', backgroundId: 'meadow' });
  });

  it('keeps the applied selection in session and reports storage write failures', () => {
    const session = createWardrobeSession({ getItem: () => null, setItem: () => { throw new Error('blocked'); } });
    const next = { skinId: 'mint', backgroundId: 'dusk' };
    expect(session.apply(next)).toBe(false);
    expect(session.equipped).toEqual(next);
    expect(session.warning).toBe(true);
  });

  it('keeps selection session-only when browser storage is unavailable', () => {
    const session = createWardrobeSession();
    expect(session.apply({ skinId: 'rose', backgroundId: 'winter' })).toBe(false);
    expect(session.equipped).toEqual({ skinId: 'rose', backgroundId: 'winter' });
    expect(session.warning).toBe(true);
  });

  it('warns when reading saved equipment throws', () => {
    const session = createWardrobeSession({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined });
    expect(session.equipped).toEqual(DEFAULT_EQUIPMENT);
    expect(session.warning).toBe(true);
  });

  it('loads optional image paths and retains procedural fallback when an image fails', async () => {
    const loaded: string[] = [];
    const loader: TextureLoader = async (path) => { loaded.push(path); if (path.includes('wing')) throw new Error('missing'); return { path } as never; };
    const textures = await loadWardrobeTextures(imageBackedFixture, loader);
    expect(loaded).toEqual(Object.values(imageBackedFixture));
    expect(textures.body).toEqual({ path: imageBackedFixture.body });
    expect(textures.background).toEqual({ path: imageBackedFixture.background });
    expect(textures.wing).toBeUndefined();
  });

  it('ignores stale image loads after a rapid selection or renderer unmount', async () => {
    let resolveFirst!: (texture: never) => void;
    const firstLoad = new Promise<never>((resolve) => { resolveFirst = resolve; });
    const loader: TextureLoader = (path) => path.includes('first') ? firstLoad : Promise.resolve({ path } as never);
    const controller = createWardrobeAssetController(loader);
    const results: string[] = [];
    const stale = controller.load({ body: '/first.svg' }, (textures) => results.push(String((textures.body as unknown as { path: string }).path)));
    await controller.load({ body: '/second.svg' }, (textures) => results.push(String((textures.body as unknown as { path: string }).path)));
    resolveFirst({ path: '/first.svg' } as never);
    await stale;
    expect(results).toEqual(['/second.svg']);
    const pending = controller.load({ body: '/third.svg' }, () => results.push('after unmount'));
    controller.dispose();
    await pending;
    expect(results).toEqual(['/second.svg']);
  });
});
