import { step, type InputFrame, type RunState } from '@doofy-duck/game-sim';

export const ACTIVE_TICK_LIMIT = 216_000;
export const CHECKPOINT_TICK_LIMIT = 120;

export interface ReplayResult {
  state: RunState;
  activeTicks: number;
  reason: '' | 'death' | 'flight_cap';
}

/** Replay server-owned state with validated, untrusted client tick inputs. */
export function replayCheckpoint(
  initialState: RunState,
  initialActiveTicks: number,
  ticks: unknown,
  tickLimit = ACTIVE_TICK_LIMIT,
): ReplayResult {
  if (!Array.isArray(ticks) || ticks.length < 1 || ticks.length > CHECKPOINT_TICK_LIMIT) {
    throw new Error('invalid checkpoint tick count');
  }
  if (!Number.isSafeInteger(tickLimit) || tickLimit < 1 ||
      !Number.isSafeInteger(initialActiveTicks) || initialActiveTicks < 0 || initialActiveTicks > tickLimit ||
      (initialState.phase !== 'READY' && initialState.phase !== 'RUNNING')) {
    throw new Error('invalid run state');
  }
  let state = initialState;
  let activeTicks = initialActiveTicks;
  for (let i = 0; i < ticks.length; i++) {
    if (activeTicks >= tickLimit) throw new Error('run active tick limit reached');
    const tick: unknown = ticks[i];
    if (!Array.isArray(tick) || tick.length > 1) throw new Error('invalid tick inputs');
    if (state.phase === 'READY' && tick.length === 0) throw new Error('ready tick must start with FLAP');
    for (const input of tick as unknown[]) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid input');
      const record = input as Record<string, unknown>;
      if (record.action !== 'FLAP' || !Number.isSafeInteger(record.sequence) || (record.sequence as number) < 0 ||
          Object.keys(record).some(key => key !== 'action' && key !== 'sequence')) throw new Error('invalid input');
    }
    state = step(state, tick as InputFrame[]).state;
    activeTicks++;
    const reason = state.phase === 'DEAD' ? 'death' : activeTicks === tickLimit ? 'flight_cap' : '';
    if (reason) {
      if (i !== ticks.length - 1) throw new Error('ticks after run completion');
      return { state, activeTicks, reason };
    }
  }
  return { state, activeTicks, reason: '' };
}
