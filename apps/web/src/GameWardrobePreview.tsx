import { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import { serializeRendererLifecycle } from './GameCanvas';
import { makeDuck, paintBackground, paintDuck } from './scene';
import { createWardrobeAssetController, type WardrobeTextures } from './wardrobe-assets';
import type { GameAppearance } from './appearance';
import type { WardrobeAssetPaths } from './wardrobe';
import { createWardrobeImageLayer } from './wardrobe-image-layer';

type Props = { appearance: GameAppearance; imageAssets?: WardrobeAssetPaths | undefined; label: string };

function paintLandscapeGraphic(landscape: Graphics, appearance: GameAppearance) {
  landscape.clear();
  landscape.rect(0, 132, 360, 58).fill(appearance.world.land);
  landscape.rect(0, 147, 360, 43).fill(appearance.world.grass);
  landscape.roundRect(34, 36, 34, 70, 7).fill(appearance.world.pipe);
  landscape.roundRect(29, 98, 44, 13, 5).fill(appearance.world.pipeCap);
  landscape.roundRect(292, 117, 34, 73, 7).fill(appearance.world.pipe);
  landscape.roundRect(287, 112, 44, 13, 5).fill(appearance.world.pipeCap);
}

function showPreviewFallback(host: HTMLElement) {
  host.dataset.previewError = 'true';
  host.replaceChildren(document.createElement('span'));
  host.firstElementChild?.setAttribute('aria-hidden', 'true');
}

export function GameWardrobePreview({ appearance, imageAssets, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const backgroundRef = useRef<Graphics | null>(null);
  const bodyGraphicRef = useRef<Graphics | null>(null);
  const wingGraphicRef = useRef<Graphics | null>(null);
  const landscapeRef = useRef<Graphics | null>(null);
  const loadAssetsRef = useRef<((paths: WardrobeAssetPaths | undefined) => void) | null>(null);
  const failRef = useRef<(() => void) | null>(null);
  const appearanceRef = useRef(appearance);
  const assetsRef = useRef(imageAssets);
  appearanceRef.current = appearance;
  assetsRef.current = imageAssets;

  useEffect(() => {
    let disposed = false;
    let tornDown = false;
    let app: Application | undefined;
    let duck: Container | undefined;
    let background: Graphics | undefined;
    let bodyGraphic: Graphics | undefined;
    let wingGraphic: Graphics | undefined;
    let landscape: Graphics | undefined;
    let imageLayer: ReturnType<typeof createWardrobeImageLayer> | undefined;
    const host = hostRef.current;
    const assetController = createWardrobeAssetController();
    if (!host) return;
    const destroyApp = () => {
      if (!app?.renderer) return;
      app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true, texture: false, textureSource: false });
      app = undefined;
      appRef.current = null;
    };
    const release = () => {
      if (tornDown) return;
      tornDown = true;
      assetController.dispose();
      imageLayer?.dispose();
      appRef.current = null; backgroundRef.current = null; bodyGraphicRef.current = null; wingGraphicRef.current = null; landscapeRef.current = null; loadAssetsRef.current = null;
      void serializeRendererLifecycle(destroyApp);
    };
    const failPreview = () => {
      showPreviewFallback(host);
      release();
    };
    failRef.current = failPreview;
    const paintLandscape = (appearance: GameAppearance) => {
      if (!landscape) return;
      paintLandscapeGraphic(landscape, appearance);
    };
    void serializeRendererLifecycle(async () => {
      try {
        app = new Application();
        await app.init({ width: 360, height: 190, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl', sharedTicker: false });
        if (disposed) { destroyApp(); return; }
        app.ticker.stop();
        app.canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(app.canvas);
        background = new Graphics();
        backgroundRef.current = background;
        paintBackground(background, appearanceRef.current);
        landscape = new Graphics(); landscapeRef.current = landscape;
        paintLandscape(appearanceRef.current);
        const duckParts = makeDuck(appearanceRef.current);
        duck = duckParts.duck; bodyGraphic = duckParts.body; wingGraphic = duckParts.wing;
        bodyGraphicRef.current = duckParts.body; wingGraphicRef.current = duckParts.wing;
        duck.position.set(180, 98);
        app.stage.addChild(background, landscape, duck);
        imageLayer = createWardrobeImageLayer({ duck, background, bodyFallback: bodyGraphic, wingFallback: wingGraphic });
        appRef.current = app;
        const applyTextures = (textures: WardrobeTextures) => {
          if (disposed || tornDown || !app || appRef.current !== app) return;
          try {
            imageLayer?.setTextures(textures);
            app.renderer.render(app.stage);
          } catch { failPreview(); }
        };
        loadAssetsRef.current = (paths) => {
          if (disposed || tornDown || !app) return;
          imageLayer?.setTextures({});
          try { app.renderer.render(app.stage); } catch { failPreview(); return; }
          void assetController.load(paths, applyTextures);
        };
        loadAssetsRef.current(assetsRef.current);
        app.renderer.render(app.stage);
      } catch {
        if (!disposed) failPreview();
        else release();
      }
    });
    return () => {
      disposed = true;
      host.replaceChildren();
      release();
      if (failRef.current === failPreview) failRef.current = null;
    };
  }, []);

  useEffect(() => { loadAssetsRef.current?.(imageAssets); }, [imageAssets]);

  useEffect(() => {
    if (!appRef.current || !bodyGraphicRef.current || !wingGraphicRef.current || !backgroundRef.current) return;
    paintDuck(bodyGraphicRef.current, wingGraphicRef.current, appearance);
    paintBackground(backgroundRef.current, appearance);
    if (landscapeRef.current) paintLandscapeGraphic(landscapeRef.current, appearance);
    try { appRef.current.renderer.render(appRef.current.stage); }
    catch { failRef.current?.(); }
  }, [appearance]);

  return <div className="wardrobe-preview-art wardrobe-preview-canvas" ref={hostRef} role="img" aria-label={label} />;
}
