import { DEFAULT_APPEARANCE, type GameAppearance } from './appearance';
import type { ShopCatalogItem } from './account-shop';
import type { WardrobeItem } from './wardrobe';
import type { Equipment } from './wardrobe';

const makeAppearance = (duck: GameAppearance['duck'], world: GameAppearance['world']): GameAppearance => Object.freeze({
  duck: Object.freeze(duck), world: Object.freeze(world),
  collectibles: DEFAULT_APPEARANCE.collectibles, fallbackCollectible: DEFAULT_APPEARANCE.fallbackCollectible,
});
const withSkin = (body: number, wing: number, highlight: number, beak: number, eye = 0x33423b) => makeAppearance(
  { body, wing, wingHighlight: highlight, beak, eye }, DEFAULT_APPEARANCE.world,
);
const withWorld = (sky: number, sun: number, land: number, cloud: number, grass: number, pipe: number, pipeCap: number) => makeAppearance(
  DEFAULT_APPEARANCE.duck, { sky, sun, land, cloud, grass, pipe, pipeCap },
);

// These palettes are local procedural preview art. The catalog remains owned by the server.
const skinAssets: Readonly<Record<string, GameAppearance>> = Object.freeze({
  classic: DEFAULT_APPEARANCE,
  mint: withSkin(0xc8e9ba, 0x83ba8e, 0xe8f5d8, 0xe99c55),
  rose: withSkin(0xf3c5c9, 0xd98f9c, 0xffe6df, 0xde876b, 0x44333a),
  celestial: withSkin(0xffe3a1, 0xf5bb65, 0xfff3c2, 0xe58b54, 0x51443d),
  royal: withSkin(0x9e9ad8, 0x6e6aa9, 0xd9d6ff, 0xe9a45f, 0x30314a),
});
const backgroundAssets: Readonly<Record<string, GameAppearance>> = Object.freeze({
  meadow: DEFAULT_APPEARANCE,
  dusk: withWorld(0x566c82, 0xf0c28d, 0x715f71, 0x9292a2, 0x6b806b, 0x638878, 0x426c63),
  winter: withWorld(0xc9e0ed, 0xfff0c8, 0xe5edf0, 0xf5fbff, 0xaec8cf, 0x7199a5, 0x527c89),
  nebula: withWorld(0x252b52, 0xf7ca92, 0x454064, 0x686b91, 0x5f6880, 0x8791ba, 0x626d9c),
  aurora: withWorld(0x153f57, 0xc8ffd8, 0x356c68, 0x86c9bd, 0x648e70, 0x71a89b, 0x4c887d),
});

export function accountShopAppearance(item: ShopCatalogItem): GameAppearance {
  const registry = item.item_type === 'skin' ? skinAssets : backgroundAssets;
  return registry[item.asset_id] ?? registry[item.item_id] ?? DEFAULT_APPEARANCE;
}

export function accountEquipmentAppearance(equipment: Equipment): GameAppearance {
  const skin = skinAssets[equipment.skinId] ?? skinAssets.classic!;
  const background = backgroundAssets[equipment.backgroundId] ?? backgroundAssets.meadow!;
  return Object.freeze({ ...skin, world: background.world });
}

export function accountShopPreviewItem(item: ShopCatalogItem): WardrobeItem {
  const appearance = accountShopAppearance(item);
  return { id: item.item_id, names: item.display_name, appearance };
}
