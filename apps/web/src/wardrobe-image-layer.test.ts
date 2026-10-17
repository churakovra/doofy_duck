import { beforeEach, describe, expect, it, vi } from 'vitest';

const pixi = vi.hoisted(() => ({ sprites: [] as Array<{ texture: unknown; width: number; height: number; rotation: number; destroyed: boolean; position: { set: ReturnType<typeof vi.fn> } }> }));
vi.mock('pixi.js', () => ({
  Sprite: class {
    texture: unknown; width = 0; height = 0; rotation = 0; destroyed = false;
    anchor = { set: vi.fn() }; position = { set: vi.fn() };
    constructor(texture: unknown) { this.texture = texture; pixi.sprites.push(this); }
    destroy() { this.destroyed = true; }
  },
}));

import { createWardrobeImageLayer } from './wardrobe-image-layer';
import { loadWardrobeTextures } from './wardrobe-assets';

function setup() {
  const duck = { children: [] as unknown[], addChild: vi.fn(function (this: { children: unknown[] }, child: unknown) { this.children.push(child); }), addChildAt: vi.fn(function (this: { children: unknown[] }, child: unknown, index: number) { this.children.splice(index, 0, child); }) };
  const parent = { addChildAt: vi.fn() };
  const background = { parent, visible: true };
  const bodyFallback = { visible: true };
  const wingFallback = { visible: true };
  return { duck, background, bodyFallback, wingFallback, layer: createWardrobeImageLayer({ duck: duck as never, background: background as never, bodyFallback: bodyFallback as never, wingFallback: wingFallback as never }) };
}

beforeEach(() => { pixi.sprites.length = 0; });

describe('shared wardrobe image layers', () => {
  it('connects real SVG fixture resources through async loading into the shared texture layer', async () => {
    const { duck, background, bodyFallback, wingFallback, layer } = setup();
    duck.children.push({}, {});
    const paths = {
      body: new URL('./test-assets/duck-body.svg', import.meta.url).href,
      wing: new URL('./test-assets/duck-wing.svg', import.meta.url).href,
      background: new URL('./test-assets/meadow.svg', import.meta.url).href,
    };
    const textures = await loadWardrobeTextures(paths, async (path) => ({ path } as never));
    layer.setTextures(textures);
    expect(bodyFallback.visible).toBe(false);
    expect(wingFallback.visible).toBe(false);
    expect(background.visible).toBe(false);
    expect(pixi.sprites).toHaveLength(3);
    expect(pixi.sprites.map(({ texture }) => (texture as { path: string }).path)).toEqual(Object.values(paths));
  });

  it('places a body image between fallback body and wing and scales its transparent logical canvas', () => {
    const { duck, background, bodyFallback, wingFallback, layer } = setup();
    const bodyGraphic = {};
    const wingGraphic = {};
    duck.children.push(bodyGraphic, wingGraphic);
    const texture = {};
    layer.setTextures({ body: texture as never });
    expect(bodyFallback.visible).toBe(false);
    expect(wingFallback.visible).toBe(true);
    expect(duck.children[1]).toBe(pixi.sprites[0]);
    expect(pixi.sprites[0]).toMatchObject({ width: 64, height: 48 });
    expect(pixi.sprites[0]!.texture).toBe(texture);
    expect(background.visible).toBe(true);
  });

  it('uses the existing wing offset and rotation while body fallback remains visible', () => {
    const { duck, background, bodyFallback, wingFallback, layer } = setup();
    duck.children.push({}, {});
    layer.setTextures({ wing: {} as never });
    expect(bodyFallback.visible).toBe(true);
    expect(wingFallback.visible).toBe(false);
    expect(pixi.sprites[0]).toMatchObject({ width: 32, height: 20 });
    expect(pixi.sprites[0]!.position.set).toHaveBeenCalledWith(-5, 2);
    layer.setWingRotation(0.7);
    expect(pixi.sprites[0]!.rotation).toBe(0.7);
    expect(background.visible).toBe(true);
  });

  it('adds the 360 by 580 background texture above its procedural fallback and restores it on failure', () => {
    const { background, bodyFallback, wingFallback, layer } = setup();
    layer.setTextures({ background: {} as never });
    expect(background.visible).toBe(false);
    expect(background.parent.addChildAt).toHaveBeenCalledWith(pixi.sprites[0], 1);
    expect(pixi.sprites[0]).toMatchObject({ width: 360, height: 580 });
    layer.setTextures({});
    expect(background.visible).toBe(true);
    expect(pixi.sprites[0]!.destroyed).toBe(true);
    expect(bodyFallback.visible).toBe(true);
    expect(wingFallback.visible).toBe(true);
  });
});
