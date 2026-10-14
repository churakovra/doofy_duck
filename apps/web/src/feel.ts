export type Fx = { x: number; y: number; kind: 'air' | 'pickup' | 'death'; born: number; seed?: number };
export type FxPool = { readonly limit: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createFxPool(limit = 24): FxPool {
  return { limit: Math.max(0, Math.floor(limit)) };
}

export function pushFx(items: readonly Fx[], item: Fx, pool: FxPool): readonly Fx[] {
  if (pool.limit === 0) return [];
  return [...items, item].slice(-pool.limit);
}

export function duckPose(vy: number, pulse: number, reducedMotion: boolean) {
  const rotation = clamp(vy / 7_000, -0.48, 0.62);
  if (reducedMotion) return { rotation, scaleX: 1, scaleY: 1 };
  const squash = clamp(pulse, 0, 1) * 0.055;
  return { rotation, scaleX: 1 + squash, scaleY: 1 - squash * 0.7 };
}

export function flapEnvelope(elapsedSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion || elapsedSeconds < 0 || elapsedSeconds >= 0.34) return 0;
  return (1 - elapsedSeconds / 0.34) ** 2;
}

export function fxPosition(fx: Fx, nowSeconds: number): { x: number; y: number; alpha: number; scale: number } {
  const age = Math.max(0, nowSeconds - fx.born);
  const duration = fx.kind === 'pickup' ? 0.56 : fx.kind === 'death' ? 0.48 : 0.38;
  const progress = clamp(age / duration, 0, 1);
  const direction = ((fx.seed ?? 0) & 1) === 0 ? -1 : 1;
  return {
    x: fx.x + direction * progress * (fx.kind === 'pickup' ? 13 : 9),
    y: fx.y - progress * (fx.kind === 'pickup' ? 25 : 16),
    alpha: 1 - progress,
    scale: fx.kind === 'pickup' ? 0.8 + progress * 0.55 : 0.5 + progress * 0.4,
  };
}
