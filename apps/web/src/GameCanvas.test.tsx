// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, createRun, createRunDescriptor } from '@doofy-duck/game-sim';

const pixi = vi.hoisted(() => ({ render: vi.fn(), destroy: vi.fn(), init: vi.fn(), fill: vi.fn() }));
vi.mock('pixi.js', () => {
  class Container {
    x = 0;
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    rotation = 0;
    addChild = vi.fn();
  }
  class Graphics extends Container {
    clear = vi.fn(() => this);
    rect = vi.fn(() => this);
    roundRect = vi.fn(() => this);
    circle = vi.fn(() => this);
    ellipse = vi.fn(() => this);
    fill = vi.fn((...args: unknown[]) => { pixi.fill(...args); return this; });
    moveTo = vi.fn(() => this);
    lineTo = vi.fn(() => this);
    closePath = vi.fn(() => this);
    stroke = vi.fn(() => this);
  }
  class Application {
    renderer = { render: pixi.render };
    stage = new Container();
    ticker = { stop: vi.fn() };
    canvas = document.createElement('canvas');
    init = vi.fn(async (...args: unknown[]) => { pixi.init(...args); return undefined; });
    destroy = pixi.destroy;
  }
  return { Application, Container, Graphics };
});

import { GameCanvas } from './GameCanvas';

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let rafId: number;
const state = createRun(createRunDescriptor({ runId: 'canvas-test', seed: 1 }, DEFAULT_CONFIG));
const runningState = { ...state, phase: 'RUNNING' as const, tick: 1 };
const frameCallbacks: FrameRequestCallback[] = [];

async function settleLifecycle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frameCallbacks.push(callback); return ++rafId; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
  pixi.render.mockReset();
  pixi.destroy.mockReset();
  pixi.init.mockReset();
  pixi.fill.mockReset();
  rafId = 0;
  frameCallbacks.length = 0;
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  act(() => root.unmount());
  await settleLifecycle();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GameCanvas renderer startup', () => {
  it('reports an initial render failure without later signaling readiness and destroys the app once', async () => {
    pixi.render.mockImplementation(() => { throw new Error('renderer failed'); });
    const onReady = vi.fn();
    act(() => root.render(<GameCanvas getState={() => state} onReady={onReady} />));
    await settleLifecycle();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(expect.any(String));
    expect(onReady).not.toHaveBeenCalledWith();
    expect(pixi.destroy).toHaveBeenCalledTimes(1);
  });

  it('signals readiness once after a successful initial render', async () => {
    const onReady = vi.fn();
    act(() => root.render(<GameCanvas getState={() => state} onReady={onReady} />));
    await settleLifecycle();
    expect(pixi.render).toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith();
    expect(pixi.destroy).not.toHaveBeenCalled();
  });

  it('repaints a changed palette without recreating the renderer or changing run state', async () => {
    const onReady = vi.fn();
    const initialAppearance = {
      duck: { body: 0x101001, beak: 0x101002, eye: 0x101003, wing: 0x101004, wingHighlight: 0x101005 },
      world: { sky: 0x202001, sun: 0x202002, land: 0x202003, grass: 0x202004, pipe: 0x202005, pipeCap: 0x202006 },
      collectibles: {},
      fallbackCollectible: { outer: 0x303001, inner: 0x303002 },
    };
    const nextAppearance = {
      ...initialAppearance,
      duck: { ...initialAppearance.duck, body: 0x404001 },
      world: { ...initialAppearance.world, sky: 0x505001 },
    };
    const stateBefore = JSON.stringify(runningState);
    act(() => root.render(<GameCanvas getState={() => runningState} onReady={onReady} appearance={initialAppearance} />));
    await settleLifecycle();
    expect(pixi.init).toHaveBeenCalledTimes(1);
    expect(pixi.fill).toHaveBeenCalledWith(0x101001);

    act(() => root.render(<GameCanvas getState={() => runningState} onReady={onReady} appearance={nextAppearance} />));
    await settleLifecycle();
    const latestFrame = frameCallbacks.at(-1);
    act(() => latestFrame?.(16));

    expect(pixi.init).toHaveBeenCalledTimes(1);
    expect(pixi.destroy).not.toHaveBeenCalled();
    expect(pixi.fill).toHaveBeenCalledWith(0x404001);
    expect(pixi.fill).toHaveBeenCalledWith(0x505001);
    expect(JSON.stringify(runningState)).toBe(stateBefore);
  });
});
