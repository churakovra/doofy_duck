// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pixi = vi.hoisted(() => ({ apps: [] as Array<{ init: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; renderer: { render: ReturnType<typeof vi.fn> }; stage: { children: unknown[] } }>, graphics: [] as Array<{ visible: boolean }>, fills: [] as unknown[], cleanup: [] as string[], load: vi.fn(async (path: string) => ({ path })), initFailure: false, renderFailure: false, deferredInit: null as Promise<void> | null }));
vi.mock('pixi.js', () => {
  class Container {
    parent: Container | null = null;
    children: unknown[] = [];
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    addChild(...children: Array<{ parent?: Container }>) { for (const child of children) { child.parent = this; this.children.push(child); } }
    addChildAt(child: { parent?: Container }, index: number) { child.parent = this; this.children.splice(index, 0, child); }
  }
  class Graphics extends Container {
    visible = true;
    clear = vi.fn(() => this); rect = vi.fn(() => this); roundRect = vi.fn(() => this); circle = vi.fn(() => this); ellipse = vi.fn(() => this);
    fill = vi.fn((color: unknown) => { pixi.fills.push(color); return this; }); moveTo = vi.fn(() => this); lineTo = vi.fn(() => this); closePath = vi.fn(() => this); stroke = vi.fn(() => this);
    constructor() { super(); pixi.graphics.push(this); }
  }
  class Application {
    renderer = { render: vi.fn(() => { if (pixi.renderFailure) throw new Error('render failed'); }) };
    stage = new Container(); ticker = { stop: vi.fn() }; canvas = document.createElement('canvas');
    init = vi.fn(async () => { if (pixi.deferredInit) await pixi.deferredInit; if (pixi.initFailure) throw new Error('init failed'); });
    destroy = vi.fn(() => { pixi.cleanup.push('app'); this.renderer = undefined as never; });
    constructor() { pixi.apps.push(this); }
  }
  class Sprite extends Container {
    anchor = { set: vi.fn() }; position = { set: vi.fn() }; width = 0; height = 0; destroyed = false;
    constructor(texture: unknown) { super(); void texture; }
    destroy = vi.fn(() => { pixi.cleanup.push('sprite'); this.destroyed = true; });
  }
  return { Application, Container, Graphics, Sprite, Assets: { load: pixi.load } };
});
vi.mock('./GameCanvas', () => ({ serializeRendererLifecycle: (operation: () => void | Promise<void>) => Promise.resolve().then(operation) }));

import { GameWardrobePreview } from './GameWardrobePreview';
import { DEFAULT_APPEARANCE } from './appearance';
import { resolveEquipmentAppearance, DEFAULT_EQUIPMENT } from './wardrobe';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  pixi.apps.length = 0; pixi.graphics.length = 0; pixi.fills.length = 0; pixi.cleanup.length = 0; pixi.load.mockReset(); pixi.load.mockImplementation(async (path) => ({ path })); pixi.initFailure = false; pixi.renderFailure = false; pixi.deferredInit = null;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('static wardrobe preview lifecycle', () => {
  it('renders a combined cosmetic preview without creating or advancing a simulation', async () => {
    act(() => root.render(<GameWardrobePreview appearance={resolveEquipmentAppearance(DEFAULT_EQUIPMENT)} label="Wardrobe" />));
    await flush();
    expect(pixi.apps).toHaveLength(1);
    expect(pixi.apps[0]!.init).toHaveBeenCalledTimes(1);
    expect(pixi.apps[0]!.renderer.render).toHaveBeenCalled();
    act(() => root.render(<GameWardrobePreview appearance={resolveEquipmentAppearance({ skinId: 'rose', backgroundId: 'winter' })} label="Wardrobe" />));
    await flush();
    expect(pixi.fills).toContain(resolveEquipmentAppearance({ skinId: 'rose', backgroundId: 'winter' }).world.land);
    expect(pixi.apps).toHaveLength(1);
    expect(pixi.apps[0]!.destroy).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Wardrobe"]')).not.toBeNull();
  });

  it('shows a procedural fallback when Pixi initialization or its first render fails', async () => {
    pixi.initFailure = true;
    act(() => root.render(<GameWardrobePreview appearance={DEFAULT_APPEARANCE} label="Wardrobe" />));
    await flush();
    expect(host.querySelector('[data-preview-error="true"] span')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    pixi.initFailure = false; pixi.renderFailure = true;
    act(() => root.render(<GameWardrobePreview appearance={DEFAULT_APPEARANCE} label="Wardrobe" />));
    await flush();
    expect(host.querySelector('[data-preview-error="true"] span')).not.toBeNull();
  });

  it('restores procedural art immediately while a replacement image is loading', async () => {
    let finishImage!: (texture: { path: string }) => void;
    act(() => root.render(<GameWardrobePreview appearance={DEFAULT_APPEARANCE} imageAssets={{ body: '/old.svg' }} label="Wardrobe" />));
    await flush();
    const app = pixi.apps[0]!;
    const duck = app.stage.children[2] as { children: Array<{ visible: boolean }> };
    const [bodyFallback] = duck.children;
    expect(bodyFallback!.visible).toBe(false);
    pixi.load.mockImplementation(() => new Promise((resolve) => { finishImage = resolve; }));
    act(() => root.render(<GameWardrobePreview appearance={DEFAULT_APPEARANCE} imageAssets={{ body: '/new.svg' }} label="Wardrobe" />));
    await flush();
    expect(bodyFallback!.visible).toBe(true);
    finishImage({ path: '/new.svg' });
    await flush();
    expect(bodyFallback!.visible).toBe(false);
    expect(app.destroy).not.toHaveBeenCalled();
  });

  it('destroys an app once if unmounted while initialization is pending', async () => {
    let finishInit!: () => void;
    pixi.deferredInit = new Promise<void>((resolve) => { finishInit = resolve; });
    act(() => root.render(<GameWardrobePreview appearance={DEFAULT_APPEARANCE} label="Wardrobe" />));
    await act(async () => { await Promise.resolve(); });
    const app = pixi.apps[0]!;
    act(() => root.unmount());
    finishInit();
    await flush();
    expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(app.destroy).toHaveBeenCalledWith({ removeView: true, releaseGlobalResources: false }, { children: true, texture: false, textureSource: false });
  });

  it('invalidates late image completion after a preview render failure and cleans up once', async () => {
    let finishImage!: (texture: { path: string }) => void;
    pixi.load.mockImplementationOnce(async (path) => ({ path }));
    act(() => root.render(<GameWardrobePreview appearance={DEFAULT_APPEARANCE} imageAssets={{ body: '/pending.svg' }} label="Wardrobe" />));
    await flush();
    const app = pixi.apps[0]!;
    pixi.load.mockImplementation(() => new Promise((resolve) => { finishImage = resolve; }));
    act(() => root.render(<GameWardrobePreview appearance={DEFAULT_APPEARANCE} imageAssets={{ body: '/replacement.svg' }} label="Wardrobe" />));
    await flush();
    const renderSpy = app.renderer.render;
    const renderCount = renderSpy.mock.calls.length;
    pixi.renderFailure = true;
    act(() => root.render(<GameWardrobePreview appearance={resolveEquipmentAppearance({ skinId: 'mint', backgroundId: 'dusk' })} imageAssets={{ body: '/replacement.svg' }} label="Wardrobe" />));
    await flush();
    expect(host.querySelector('[data-preview-error="true"] span')).not.toBeNull();
    expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(pixi.cleanup).toEqual(['sprite', 'app']);
    finishImage({ path: '/pending.svg' });
    await flush();
    expect(renderSpy).toHaveBeenCalledTimes(renderCount + 1);
    act(() => root.unmount());
    await flush();
    expect(app.destroy).toHaveBeenCalledTimes(1);
  });
});
