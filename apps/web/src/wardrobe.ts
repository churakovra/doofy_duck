import { DEFAULT_APPEARANCE, type GameAppearance } from './appearance';
import type { Locale } from './locale';
import type { StorageLike } from './storage';

export type WardrobeId = string;
export type Equipment = Readonly<{ skinId: WardrobeId; backgroundId: WardrobeId }>;
export type WardrobeAssetPaths = Readonly<{ body?: string | undefined; wing?: string | undefined; background?: string | undefined }>;
export type WardrobeItem = Readonly<{
  id: WardrobeId;
  names: Readonly<Record<Locale, string>>;
  appearance: GameAppearance;
  image?: WardrobeAssetPaths;
}>;

const appearance = (duck: GameAppearance['duck'], world: GameAppearance['world']): GameAppearance => Object.freeze({
  duck: Object.freeze(duck), world: Object.freeze(world),
  collectibles: DEFAULT_APPEARANCE.collectibles,
  fallbackCollectible: DEFAULT_APPEARANCE.fallbackCollectible,
});

export const SKIN_CATALOG: readonly WardrobeItem[] = Object.freeze([
  { id: 'classic', names: { ru: 'Классика', en: 'Classic' }, appearance: DEFAULT_APPEARANCE },
  { id: 'mint', names: { ru: 'Мята', en: 'Mint' }, appearance: appearance({ body: 0xc8e9ba, beak: 0xe99c55, eye: 0x33423b, wing: 0x83ba8e, wingHighlight: 0xe8f5d8 }, DEFAULT_APPEARANCE.world) },
  { id: 'rose', names: { ru: 'Роза', en: 'Rose' }, appearance: appearance({ body: 0xf3c5c9, beak: 0xde876b, eye: 0x44333a, wing: 0xd98f9c, wingHighlight: 0xffe6df }, DEFAULT_APPEARANCE.world) },
]);
export const BACKGROUND_CATALOG: readonly WardrobeItem[] = Object.freeze([
  { id: 'meadow', names: { ru: 'Луг', en: 'Meadow' }, appearance: DEFAULT_APPEARANCE },
  { id: 'dusk', names: { ru: 'Сумерки', en: 'Dusk' }, appearance: appearance(DEFAULT_APPEARANCE.duck, { sky: 0x566c82, sun: 0xf0c28d, land: 0x715f71, cloud: 0x9292a2, grass: 0x6b806b, pipe: 0x638878, pipeCap: 0x426c63 }) },
  { id: 'winter', names: { ru: 'Зима', en: 'Winter' }, appearance: appearance(DEFAULT_APPEARANCE.duck, { sky: 0xc9e0ed, sun: 0xfff0c8, land: 0xe5edf0, cloud: 0xf5fbff, grass: 0xaec8cf, pipe: 0x7199a5, pipeCap: 0x527c89 }) },
]);

export const WARDROBE_STORAGE_KEY = 'doofy-duck:wardrobe:v1';
export const DEFAULT_EQUIPMENT: Equipment = Object.freeze({ skinId: 'classic', backgroundId: 'meadow' });

export function createWardrobeCatalog(skins: readonly WardrobeItem[], backgrounds: readonly WardrobeItem[]) {
  const assertUnique = (items: readonly WardrobeItem[]) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or empty wardrobe ID: ${item.id}`);
      ids.add(item.id);
    }
  };
  assertUnique(skins);
  assertUnique(backgrounds);
  return Object.freeze({ skins: Object.freeze([...skins]), backgrounds: Object.freeze([...backgrounds]) });
}

export const WARDROBE_CATALOG = createWardrobeCatalog(SKIN_CATALOG, BACKGROUND_CATALOG);

export function resolveEquipmentAppearance(equipment: Equipment, skins = SKIN_CATALOG, backgrounds = BACKGROUND_CATALOG): GameAppearance {
  const skin = skins.find((item) => item.id === equipment.skinId) ?? skins[0]!;
  const background = backgrounds.find((item) => item.id === equipment.backgroundId) ?? backgrounds[0]!;
  return appearance(skin.appearance.duck, background.appearance.world);
}

export function resolveEquipmentAssets(equipment: Equipment, skins = SKIN_CATALOG, backgrounds = BACKGROUND_CATALOG): WardrobeAssetPaths | undefined {
  const skin = skins.find((item) => item.id === equipment.skinId) ?? skins[0]!;
  const background = backgrounds.find((item) => item.id === equipment.backgroundId) ?? backgrounds[0]!;
  const combined = { body: skin.image?.body, wing: skin.image?.wing, background: background.image?.background };
  return Object.values(combined).some(Boolean) ? combined : undefined;
}

function sanitizeEquipment(raw: unknown): Equipment {
  if (!raw || typeof raw !== 'object') return DEFAULT_EQUIPMENT;
  const value = raw as Record<string, unknown>;
  return {
    skinId: typeof value.skinId === 'string' && SKIN_CATALOG.some((item) => item.id === value.skinId) ? value.skinId : DEFAULT_EQUIPMENT.skinId,
    backgroundId: typeof value.backgroundId === 'string' && BACKGROUND_CATALOG.some((item) => item.id === value.backgroundId) ? value.backgroundId : DEFAULT_EQUIPMENT.backgroundId,
  };
}

export function createWardrobeSession(storage?: Pick<StorageLike, 'getItem' | 'setItem'>) {
  let equipped = DEFAULT_EQUIPMENT;
  let warning = !storage;
  try {
    const stored = storage?.getItem(WARDROBE_STORAGE_KEY);
    if (stored) {
      const record: unknown = JSON.parse(stored);
      if (record && typeof record === 'object' && (record as { version?: unknown }).version === 1) equipped = sanitizeEquipment((record as { equipment?: unknown }).equipment);
    }
  } catch { warning = true; }
  return {
    get equipped() { return equipped; },
    get warning() { return warning; },
    apply(next: Equipment) {
      equipped = sanitizeEquipment(next);
      if (!storage) { warning = true; return false; }
      try {
        storage.setItem(WARDROBE_STORAGE_KEY, JSON.stringify({ version: 1, equipment: equipped }));
        warning = false;
        return true;
      } catch { warning = true; return false; }
    },
    cancel(draft: Equipment) { void draft; return equipped; },
  };
}

export function readBrowserWardrobeStorage(): Pick<StorageLike, 'getItem' | 'setItem'> | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
