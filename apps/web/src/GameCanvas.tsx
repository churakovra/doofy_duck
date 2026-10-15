import React, { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import type { RunState } from '@doofy-duck/game-sim';
import { createFxPool, duckPose, flapEnvelope, pushFx, type Fx } from './feel';
import { useLocale } from './locale';
import type { RuntimeErrorKey } from './messages.ru';
import { DEFAULT_APPEARANCE, type GameAppearance } from './appearance';
import { HEIGHT, WIDTH, makeBackground, makeDuck, makeParallax, paintBackground, paintDuck, paintEffects, paintWorld, px } from './scene';
const FX_POOL = createFxPool(20);

let rendererLifecycleQueue: Promise<void> = Promise.resolve();

export function serializeRendererLifecycle(operation: () => void | Promise<void>): Promise<void> {
  const next = rendererLifecycleQueue.then(operation, operation);
  rendererLifecycleQueue = next.catch(() => undefined);
  return next;
}

type Feedback = { flapSerial: number; pickupSerial: number; deathSerial: number };
type Props = {
  getState: () => RunState;
  onReady: (error?: RuntimeErrorKey) => void;
  getFeedback?: () => Feedback;
  appearance?: GameAppearance;
};
type Scene = { app: Application; world: Graphics; duck: Container; wing: Graphics; effects: Graphics; parallax: Container };
export function GameCanvas({ getState, onReady, getFeedback, appearance = DEFAULT_APPEARANCE }: Props) {
  const { messages } = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const getStateRef = useRef(getState);
  const feedbackRef = useRef(getFeedback);
  const appearanceRef = useRef(appearance);
  const canvasLabelRef = useRef(messages.gameCanvasLabel);
  const frameRef = useRef(0);
  getStateRef.current = getState;
  feedbackRef.current = getFeedback;
  appearanceRef.current = appearance;
  canvasLabelRef.current = messages.gameCanvasLabel;

  useEffect(() => {
    const canvas = sceneRef.current?.app.canvas;
    canvas?.setAttribute('aria-label', messages.gameCanvasLabel);
  }, [messages.gameCanvasLabel]);

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
        const initialAppearance = appearanceRef.current;
        await app.init({ width: WIDTH, height: HEIGHT, background: initialAppearance.world.sky, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl', sharedTicker: false });
        if (disposed) return;
        app.ticker.stop();
        app.canvas.setAttribute('aria-label', canvasLabelRef.current);
        app.canvas.setAttribute('role', 'img');
        host.appendChild(app.canvas);
        const world = new Graphics();
        const duckParts = makeDuck(initialAppearance);
        const effectsGraphic = new Graphics();
        const background = makeBackground(initialAppearance);
        const parallax = makeParallax();
        app.stage.addChild(background, parallax, world, duckParts.duck, effectsGraphic);
        const scene: Scene = { app, world, duck: duckParts.duck, wing: duckParts.wing, effects: effectsGraphic, parallax };
        sceneRef.current = scene;
        let previousAppearance = initialAppearance;
        let renderFailed = false;
        const failRender = (reason?: unknown) => {
          if (disposed || renderFailed) return;
          renderFailed = true;
          console.error('Game renderer stopped', reason);
          cancelAnimationFrame(frameRef.current);
          onReady('flightStoppedGraphicsError');
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
            const currentAppearance = appearanceRef.current;
            const appearanceChanged = currentAppearance !== previousAppearance;
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
            if (newSimulationTick || appearanceChanged) paintWorld(world, state, currentAppearance);
            if (appearanceChanged) {
              paintDuck(duckParts.body, duckParts.wing, currentAppearance);
              paintBackground(background, currentAppearance);
            }
            const pose = duckPose(state.duck.vy, flapEnvelope(cosmeticTime - flapStarted, prefersReducedMotion), prefersReducedMotion);
            duckParts.duck.position.set(px(state.duck.x), px(state.duck.y));
            duckParts.duck.rotation = pose.rotation;
            duckParts.duck.scale.set(pose.scaleX, pose.scaleY);
            duckParts.wing.rotation = prefersReducedMotion ? 0 : 0.25 - flapEnvelope(cosmeticTime - flapStarted, false) * 1.7 + Math.sin(cosmeticTime * 18) * (state.phase === 'RUNNING' ? 0.12 : 0);
            parallax.x = prefersReducedMotion ? 0 : (-(state.tick * 0.16) % WIDTH + WIDTH) % WIDTH;
            paintEffects(effectsGraphic, effects, cosmeticTime, prefersReducedMotion);
            app.renderer.render(app.stage);
            previousAppearance = currentAppearance;
            lastPhase = state.phase;
            frameRef.current = requestAnimationFrame(draw);
          } catch (error) {
            failRender(error);
          }
        };
        draw(performance.now());
        if (!disposed && !renderFailed) onReady();
      } catch {
        if (!disposed) onReady('graphicsStartupError');
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
