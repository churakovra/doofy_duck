import React, { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import type { RunState } from '@doofy-duck/game-sim';
import { createFxPool, duckPose, flapEnvelope, fxPosition, pushFx, type Fx } from './feel';
import { messages } from './messages.ru';

const WIDTH = 360;
const HEIGHT = 580;
const px = (value: number) => value / 1000;
const FX_POOL = createFxPool(20);

let rendererLifecycleQueue: Promise<void> = Promise.resolve();

export function serializeRendererLifecycle(operation: () => void | Promise<void>): Promise<void> {
  const next = rendererLifecycleQueue.then(operation, operation);
  rendererLifecycleQueue = next.catch(() => undefined);
  return next;
}

type Feedback = { flapSerial: number; pickupSerial: number; deathSerial: number };
type Props = { getState: () => RunState; onReady: (error?: string) => void; getFeedback?: () => Feedback };
type Scene = { app: Application; world: Graphics; duck: Container; wing: Graphics; effects: Graphics; parallax: Container };

function paintWorld(world: Graphics, state: RunState): void {
  world.clear();
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
}

function makeBackground(): Graphics {
  const background = new Graphics();
  background.circle(300, 88, 35).fill({ color: 0xffd98b, alpha: 0.8 });
  background.ellipse(285, 505, 76, 20).fill({ color: 0xbedbd1, alpha: 0.7 });
  return background;
}

function makeParallax(): Container {
  const layer = new Container();
  const marks = new Graphics();
  marks.ellipse(82, 160, 28, 5).fill({ color: 0xffffff, alpha: 0.26 });
  marks.ellipse(245, 230, 20, 4).fill({ color: 0xffffff, alpha: 0.22 });
  marks.ellipse(154, 372, 34, 5).fill({ color: 0xc1ded3, alpha: 0.28 });
  marks.ellipse(316, 430, 24, 4).fill({ color: 0xc1ded3, alpha: 0.2 });
  layer.addChild(marks);
  return layer;
}

function makeDuck(): { duck: Container; wing: Graphics } {
  const duck = new Container();
  const body = new Graphics();
  body.ellipse(0, 0, 19, 15).fill(0xffd267);
  body.moveTo(15, -4).lineTo(27, 0).lineTo(15, 4).closePath().fill(0xe88452);
  body.circle(7, -5, 2.5).fill(0x33423b);
  const wing = new Graphics();
  wing.ellipse(-3, 0, 12, 7).fill(0xe99b39);
  wing.moveTo(-10, 0).lineTo(-1, 3).lineTo(5, 0).stroke({ color: 0xffe09b, width: 2 });
  wing.position.set(-5, 2);
  duck.addChild(body, wing);
  return { duck, wing };
}

function paintEffects(graphic: Graphics, effects: readonly Fx[], now: number, reducedMotion: boolean): void {
  graphic.clear();
  if (reducedMotion) return;
  for (const fx of effects) {
    const pose = fxPosition(fx, now);
    if (pose.alpha <= 0) continue;
    if (fx.kind === 'pickup') {
      graphic.circle(pose.x, pose.y, 5 * pose.scale).fill({ color: 0xffe59c, alpha: pose.alpha * 0.8 });
      graphic.circle(pose.x, pose.y, 10 * pose.scale).stroke({ color: 0xf5bd56, alpha: pose.alpha * 0.65, width: 1.5 });
    } else if (fx.kind === 'air') {
      graphic.moveTo(pose.x, pose.y).lineTo(pose.x - 9 * pose.scale, pose.y + 2)
        .stroke({ color: 0xffffff, alpha: pose.alpha * 0.9, width: 2.5 });
    } else {
      graphic.circle(pose.x, pose.y, 3 * pose.scale).fill({ color: fx.kind === 'death' ? 0xe88452 : 0xffffff, alpha: pose.alpha * 0.65 });
    }
  }
}

export function GameCanvas({ getState, onReady, getFeedback }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const getStateRef = useRef(getState);
  const feedbackRef = useRef(getFeedback);
  const frameRef = useRef(0);
  getStateRef.current = getState;
  feedbackRef.current = getFeedback;

  useEffect(() => {
    let disposed = false;
    let app: Application | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let previousTick = -1;
    let lastTime = 0;
    let cosmeticTime = 0;
    let lastFlapSerial = 0;
    let lastPickupSerial = 0;
    let lastDeathSerial = 0;
    let lastPhase: RunState['phase'] | undefined;
    let flapStarted = -10;
    let effects: readonly Fx[] = [];
    let fxSerial = 0;
    let previousCollectibles = new Map<string, { x: number; y: number }>();
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
        app.canvas.setAttribute('aria-label', messages.gameCanvasLabel);
        app.canvas.setAttribute('role', 'img');
        host.appendChild(app.canvas);
        const world = new Graphics();
        const duckParts = makeDuck();
        const effectsGraphic = new Graphics();
        const background = makeBackground();
        const parallax = makeParallax();
        app.stage.addChild(background, parallax, world, duckParts.duck, effectsGraphic);
        const scene: Scene = { app, world, duck: duckParts.duck, wing: duckParts.wing, effects: effectsGraphic, parallax };
        sceneRef.current = scene;
        let renderFailed = false;
        const failRender = (reason?: unknown) => {
          if (disposed || renderFailed) return;
          renderFailed = true;
          console.error('Game renderer stopped', reason);
          cancelAnimationFrame(frameRef.current);
          onReady(messages.flightStoppedGraphicsError);
          sceneRef.current = null;
          void serializeRendererLifecycle(destroyApp);
        };
        resizeObserver = new ResizeObserver(() => {
          try { app?.renderer.render(app.stage); } catch (error) { failRender(error); }
        });
        resizeObserver.observe(host);
        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const draw = (time: number) => {
          if (disposed || !app) return;
          try {
            const state = getStateRef.current();
            const feedback = feedbackRef.current?.();
            const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.05);
            lastTime = time;
            if (state.phase === 'RUNNING' || state.phase === 'DEAD') cosmeticTime += dt;
            const newSimulationTick = state.tick !== previousTick;
            if (state.phase === 'READY' && lastPhase !== 'READY') {
              effects = [];
              previousCollectibles = new Map();
              previousTick = -1;
              lastFlapSerial = feedback?.flapSerial ?? 0;
              lastPickupSerial = feedback?.pickupSerial ?? 0;
              lastDeathSerial = feedback?.deathSerial ?? 0;
              flapStarted = -10;
              cosmeticTime = 0;
            }
            if (state.phase === 'RUNNING' && lastPhase !== 'RUNNING') {
              lastPickupSerial = feedback?.pickupSerial ?? lastPickupSerial;
              lastDeathSerial = feedback?.deathSerial ?? lastDeathSerial;
            }
            if ((feedback?.flapSerial ?? lastFlapSerial) !== lastFlapSerial) {
              lastFlapSerial = feedback!.flapSerial;
              flapStarted = cosmeticTime;
              if (!prefersReducedMotion) {
                for (let i = 0; i < 3; i++) effects = pushFx(effects, {
                  x: px(state.duck.x) - 16 - i * 4,
                  y: px(state.duck.y) + (i - 1) * 7,
                  kind: 'air', born: cosmeticTime, seed: fxSerial++,
                }, FX_POOL);
              }
            } else if (state.duck.vy < 0 && state.tick !== previousTick && feedback === undefined) {
              flapStarted = cosmeticTime;
            }
            if (newSimulationTick) {
              const currentCollectibles = new Map(state.collectibles.map((item) => [item.id, { x: px(item.x), y: px(item.y) }]));
              if (feedback && feedback.pickupSerial !== lastPickupSerial) {
                lastPickupSerial = feedback.pickupSerial;
                effects = pushFx(effects, { x: px(state.duck.x), y: px(state.duck.y), kind: 'pickup', born: cosmeticTime, seed: fxSerial++ }, FX_POOL);
              } else if (!feedback) {
                for (const [id, item] of previousCollectibles) {
                  const nearDuck = Math.abs(item.x - px(state.duck.x)) < 38 && Math.abs(item.y - px(state.duck.y)) < 38;
                  if (!currentCollectibles.has(id) && nearDuck) effects = pushFx(effects, { ...item, kind: 'pickup', born: cosmeticTime, seed: fxSerial++ }, FX_POOL);
                }
              }
              previousCollectibles = currentCollectibles;
              previousTick = state.tick;
            }
            if (state.phase === 'DEAD' && lastPhase !== 'DEAD') {
              effects = pushFx(effects, { x: px(state.duck.x), y: px(state.duck.y), kind: 'death', born: cosmeticTime, seed: fxSerial++ }, FX_POOL);
            }
            if ((feedback?.pickupSerial ?? lastPickupSerial) !== lastPickupSerial) lastPickupSerial = feedback!.pickupSerial;
            if ((feedback?.deathSerial ?? lastDeathSerial) !== lastDeathSerial) lastDeathSerial = feedback!.deathSerial;
            if (state.phase === 'RUNNING' && newSimulationTick && state.tick % 14 === 0 && !prefersReducedMotion) {
              effects = pushFx(effects, { x: px(state.duck.x) - 18, y: px(state.duck.y) + 4, kind: 'air', born: cosmeticTime, seed: fxSerial++ }, FX_POOL);
            }
            effects = effects.filter((fx) => cosmeticTime - fx.born < (fx.kind === 'pickup' ? 0.56 : fx.kind === 'death' ? 0.48 : 0.38));
            if (newSimulationTick) paintWorld(world, state);
            const pose = duckPose(state.duck.vy, flapEnvelope(cosmeticTime - flapStarted, prefersReducedMotion), prefersReducedMotion);
            duckParts.duck.position.set(px(state.duck.x), px(state.duck.y));
            duckParts.duck.rotation = pose.rotation;
            duckParts.duck.scale.set(pose.scaleX, pose.scaleY);
            duckParts.wing.rotation = prefersReducedMotion ? 0 : 0.25 - flapEnvelope(cosmeticTime - flapStarted, false) * 1.7 + Math.sin(cosmeticTime * 18) * (state.phase === 'RUNNING' ? 0.12 : 0);
            parallax.x = prefersReducedMotion ? 0 : (-(state.tick * 0.16) % WIDTH + WIDTH) % WIDTH;
            paintEffects(effectsGraphic, effects, cosmeticTime, prefersReducedMotion);
            app.renderer.render(app.stage);
            lastPhase = state.phase;
            frameRef.current = requestAnimationFrame(draw);
          } catch (error) {
            failRender(error);
          }
        };
        draw(performance.now());
        onReady();
      } catch {
        if (!disposed) onReady(messages.graphicsStartupError);
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
