import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, canonicalState, createRun, createRunDescriptor } from '@doofy-duck/game-sim';

vi.mock('pixi.js', () => ({
  Container: class {
    children: unknown[] = [];
    addChild(...children: unknown[]) { this.children.push(...children); }
    position = { set: vi.fn() };
  },
  Graphics: class {
    calls: Array<{ method: string; args: unknown[] }> = [];
    position = { set: vi.fn() };
    clear() { this.calls.push({ method: 'clear', args: [] }); return this; }
    rect(...args: unknown[]) { this.calls.push({ method: 'rect', args }); return this; }
    roundRect(...args: unknown[]) { this.calls.push({ method: 'roundRect', args }); return this; }
    circle(...args: unknown[]) { this.calls.push({ method: 'circle', args }); return this; }
    ellipse(...args: unknown[]) { this.calls.push({ method: 'ellipse', args }); return this; }
    fill(...args: unknown[]) { this.calls.push({ method: 'fill', args }); return this; }
    moveTo(...args: unknown[]) { this.calls.push({ method: 'moveTo', args }); return this; }
    lineTo(...args: unknown[]) { this.calls.push({ method: 'lineTo', args }); return this; }
    closePath() { this.calls.push({ method: 'closePath', args: [] }); return this; }
    stroke(...args: unknown[]) { this.calls.push({ method: 'stroke', args }); return this; }
  },
}));

import { Graphics } from 'pixi.js';
import { paintWorld, makeDuck, makeBackground } from './scene';
import { DEFAULT_APPEARANCE, type GameAppearance } from './appearance';

type RecordingGraphics = { calls: Array<{ method: string; args: unknown[] }> };
const graphics = (): RecordingGraphics => new Graphics() as unknown as RecordingGraphics;
const fills = (graphic: RecordingGraphics) => graphic.calls
  .filter(call => call.method === 'fill')
  .map(call => {
    const fill = call.args[0];
    return typeof fill === 'object' && fill !== null && 'color' in fill
      ? fill.color
      : fill;
  });

describe('scene rendering', () => {
  it('draws floor, ceiling, and pipe extents from the run configuration', () => {
    const config = {
      ...DEFAULT_CONFIG,
      pipes: { ...DEFAULT_CONFIG.pipes, ceilingY: 20_000, floorY: 530_000, gapHeight: 100_000 },
    };
    const initial = createRun(createRunDescriptor({ runId: 'scene-bounds', seed: 1 }, config), config);
    const state = {
      ...initial,
      pipes: [{ id: 'pipe', index: 0, x: 120_000, gapCenter: 280_000, scored: false }],
      collectibles: [],
    };
    const world = graphics();

    paintWorld(world as never, state);

    const pipeRects = world.calls.filter(call => call.method === 'roundRect');
    expect(pipeRects).toHaveLength(4);
    expect(pipeRects[0]!.args).toEqual([94, 20, 52, 210, 7]);
    expect(pipeRects[2]!.args).toEqual([94, 330, 52, 200, 7]);
    const floorRects = world.calls.filter(call => call.method === 'rect');
    expect(floorRects).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: [0, 0, 360, 20] }),
      expect.objectContaining({ args: [0, 530, 360, 50] }),
      expect.objectContaining({ args: [0, 530, 360, 4] }),
    ]));
  });

  it('chooses collectible art by definition appearance and falls back for unknown appearances', () => {
    const config = {
      ...DEFAULT_CONFIG,
      collectibles: [
        { ...DEFAULT_CONFIG.collectibles[0]!, typeId: 'FEATHER', appearance: 'game-star-v1' },
      ],
    };
    const initial = createRun(createRunDescriptor({ runId: 'scene-pickups', seed: 2 }, config), config);
    const state = {
      ...initial,
      pipes: [],
      collectibles: [
        { id: 'custom', typeId: 'FEATHER', x: 100_000, y: 200_000, amount: 1, radius: 7_000, collected: false },
        { id: 'unknown', typeId: 'GAME_STAR', x: 140_000, y: 240_000, amount: 1, radius: 7_000, collected: false },
      ],
      config: {
        ...config,
        collectibles: [
          ...config.collectibles,
          { ...DEFAULT_CONFIG.collectibles[1]!, typeId: 'GAME_STAR', appearance: 'constructor' },
        ],
      },
    };
    const appearance = {
      ...DEFAULT_APPEARANCE,
      fallbackCollectible: { outer: 0x303001, inner: 0x303002 },
    };
    const world = graphics();

    paintWorld(world as never, state, appearance);

    expect(fills(world)).toContain(DEFAULT_APPEARANCE.collectibles['game-star-v1']!.outer);
    expect(fills(world)).toContain(appearance.fallbackCollectible.outer);
    expect(fills(world)).not.toContain(DEFAULT_APPEARANCE.collectibles['feather-v1']!.outer);
  });

  it('applies custom palette colors to duck, background, and world without changing simulation identity', () => {
    const appearance: GameAppearance = {
      duck: { body: 0x101001, beak: 0x101002, eye: 0x101003, wing: 0x101004, wingHighlight: 0x101005 },
      world: { sky: 0x202001, sun: 0x202002, land: 0x202003, grass: 0x202004, pipe: 0x202005, pipeCap: 0x202006 },
      collectibles: {},
      fallbackCollectible: { outer: 0x303001, inner: 0x303002 },
    };
    const state = createRun(createRunDescriptor({ runId: 'scene-palette', seed: 3 }, DEFAULT_CONFIG));
    const identityBefore = canonicalState(state);
    const { duck, wing } = makeDuck(appearance);
    const background = makeBackground(appearance);
    const world = graphics();

    paintWorld(world as never, { ...state, pipes: [], collectibles: [] }, appearance);

    const duckColors = [...fills(duck.children[0] as unknown as RecordingGraphics), ...fills(wing as unknown as RecordingGraphics)];
    expect(duckColors).toEqual(expect.arrayContaining([0x101001, 0x101002, 0x101003, 0x101004]));
    expect(duckColors).not.toContain(0xffd267);
    expect(fills(background as unknown as RecordingGraphics)).toContain(0x202002);
    expect(fills(background as unknown as RecordingGraphics)).toContain(0x202003);
    expect(fills(world)).toEqual(expect.arrayContaining([0x202003, 0x202004]));
    expect(canonicalState(state)).toBe(identityBefore);
  });
});
