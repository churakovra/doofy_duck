import React, { useEffect, useRef } from 'react';
import { Application, Graphics } from 'pixi.js';
import type { RunState } from '@doofy-duck/game-sim';

const WIDTH = 360;
const HEIGHT = 580;
const px = (value: number) => value / 1000;

let rendererLifecycleQueue: Promise<void> = Promise.resolve();

export function serializeRendererLifecycle(operation: () => void | Promise<void>): Promise<void> {
  const next = rendererLifecycleQueue.then(operation, operation);
  rendererLifecycleQueue = next.catch(() => undefined);
  return next;
}

type Props = { getState: () => RunState; onReady: (error?: string) => void };

function paintWorld(world: Graphics, duckGraphic: Graphics, state: RunState): void {
  world.clear();
  world.rect(0, 0, WIDTH, HEIGHT).fill(0xdff3ec);
  world.circle(300, 88, 35).fill({ color: 0xffd98b, alpha: 0.8 });
  world.ellipse(285, 505, 76, 20).fill({ color: 0xbedbd1, alpha: 0.7 });
  for (const pipe of state.pipes) {
    const x = px(pipe.x);
    const gapTop = px(pipe.gapCenter - Math.floor(state.config.pipes.gapHeight / 2));
    const gapBottom = px(pipe.gapCenter + Math.floor(state.config.pipes.gapHeight / 2));
    const width = px(state.config.pipes.width);
    world.roundRect(x - width / 2, 0, width, gapTop, 7).fill(0x5e9b81);
    world.roundRect(x - width / 2 - 5, gapTop - 17, width + 10, 17, 5).fill(0x427c65);
    world.roundRect(x - width / 2, gapBottom, width, HEIGHT - gapBottom, 7).fill(0x5e9b81);
    world.roundRect(x - width / 2 - 5, gapBottom, width + 10, 17, 5).fill(0x427c65);
  }
  world.rect(0, HEIGHT - 19, WIDTH, 19).fill(0xe6c78e);
  world.rect(0, HEIGHT - 19, WIDTH, 4).fill(0xb1c988);
  for (const collectible of state.collectibles) {
    const x = px(collectible.x);
    const y = px(collectible.y);
    world.circle(x, y, 13).fill(collectible.typeId === 'GAME_STAR' ? 0xf5bd56 : 0xfffbdf);
    world.circle(x, y, 7).fill(collectible.typeId === 'GAME_STAR' ? 0xffe59c : 0xd8aa66);
  }

  duckGraphic.clear();
  const x = px(state.duck.x);
  const y = px(state.duck.y);
  duckGraphic.ellipse(x, y, 19, 15).fill(0xffd267);
  duckGraphic.ellipse(x - 5, y + 6, 9, 6).fill(0xf0a94b);
  duckGraphic.moveTo(x + 15, y - 4).lineTo(x + 27, y).lineTo(x + 15, y + 4).closePath().fill(0xe88452);
  duckGraphic.circle(x + 7, y - 5, 2.5).fill(0x33423b);
}

export function GameCanvas({ getState, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ app: Application; world: Graphics; duck: Graphics } | null>(null);
  const getStateRef = useRef(getState);
  const frameRef = useRef(0);
  getStateRef.current = getState;

  useEffect(() => {
    let disposed = false;
    let app: Application | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const host = hostRef.current;
    if (!host) return;

    const destroyApp = () => {
      if (!app?.renderer) return;
      app.destroy(true, { children: true });
      app = undefined;
    };

    void serializeRendererLifecycle(async () => {
      try {
        app = new Application();
        await app.init({ width: WIDTH, height: HEIGHT, background: 0xdff3ec, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl', sharedTicker: false });
        if (disposed) return;
        app.ticker.stop();
        app.canvas.setAttribute('aria-label', 'Doofy Duck game canvas');
        app.canvas.setAttribute('role', 'img');
        host.appendChild(app.canvas);
        const world = new Graphics();
        const duck = new Graphics();
        app.stage.addChild(world, duck);
        sceneRef.current = { app, world, duck };
        let renderFailed = false;
        const failRender = (reason?: unknown) => {
          if (disposed || renderFailed) return;
          renderFailed = true;
          console.error('Game renderer stopped', reason);
          cancelAnimationFrame(frameRef.current);
          onReady('Графика остановилась. Обновите страницу и попробуйте ещё раз.');
          sceneRef.current = null;
          void serializeRendererLifecycle(destroyApp);
        };
        resizeObserver = new ResizeObserver(() => {
          try { app?.renderer.render(app.stage); } catch (error) { failRender(error); }
        });
        resizeObserver.observe(host);
        paintWorld(world, duck, getStateRef.current());
        app.renderer.render(app.stage);
        onReady();
        const draw = () => {
          if (disposed || !app) return;
          try {
            paintWorld(world, duck, getStateRef.current());
            app.renderer.render(app.stage);
            frameRef.current = requestAnimationFrame(draw);
          } catch (error) {
            failRender(error);
          }
        };
        frameRef.current = requestAnimationFrame(draw);
      } catch {
        if (!disposed) onReady('Графика не запустилась. Обновите страницу и попробуйте ещё раз.');
        destroyApp();
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frameRef.current);
      resizeObserver?.disconnect();
      if (sceneRef.current?.app === app) sceneRef.current = null;
      host.replaceChildren();
      void serializeRendererLifecycle(destroyApp);
    };
  }, [onReady]);

  return <div className="canvas-host" ref={hostRef} data-testid="canvas-host" />;
}
