// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameRun } from './useGameRun';
import { LocaleProvider, useLocale } from './locale';
import { DEFAULT_CONFIG, BONUS_SEGMENTS_DEFAULT_CONFIG, COIN_COURSE_DEFAULT_CONFIG, PRIOR_DEFAULT_CONFIG, VARIED_OBSTACLE_DEFAULT_CONFIG, WETLAND_DEFAULT_CONFIG, createRun, createRunDescriptor, type GameConfig, type GameEvent, type RunDescriptorIdentity, type RunState } from '@doofy-duck/game-sim';

let run: ReturnType<typeof useGameRun>;
let frameId: number;
let now: number;
let frames: Map<number, FrameRequestCallback>;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let options: { config?: GameConfig; createIdentity?: () => RunDescriptorIdentity; initialState?: RunState; onEvents?: (events: readonly GameEvent[]) => void; onTick?: (state: unknown, ticks: readonly { sequence: number; action: 'FLAP' }[]) => void; activeTickLimit?: number } = {};
const callbacks = {
  onFlapUnlock: vi.fn(), onFlap: vi.fn(), onPickup: vi.fn(),
  onPhaseChange: vi.fn(), onRunEnded: vi.fn(),
};
let changeLocale: ReturnType<typeof useLocale>['setLocale'];
let modalOpen = false;
function Harness() {
  changeLocale = useLocale().setLocale;
  run = useGameRun(() => !modalOpen, callbacks, options);
  return <select aria-label="Language"><option value="ru">Русский</option><option value="en">English</option></select>;
}
function frame(elapsed: number) {
  act(() => {
    now += elapsed;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  frameId = 0;
  now = 0;
  frames = new Map();
  options = {};
  modalOpen = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<LocaleProvider><Harness /></LocaleProvider>));
  act(() => run.acceptRenderer());
  frame(0);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('run clock integration', () => {
  it('restarts a fresh default run with the varied-base identity', () => {
    act(() => run.restart());
    expect(run.getState().config.wetland?.catalogVersion).toBe(12);
    expect(run.getState().descriptor).toMatchObject({
      simulationVersion: '3.1.0', generatorVersion: '3.1.0', configId: 'dd-v3-varied-base-v1',
    });
    expect(run.getState().config).toEqual(DEFAULT_CONFIG);
  });

  it('resumes a frozen 2.5 bonus-segments run without changing its identity', () => {
    const config = BONUS_SEGMENTS_DEFAULT_CONFIG;
    const state = createRun(createRunDescriptor({ runId: 'retained-bonus-segments-v2.5', seed: 44 }, config), config);
    options = { config, initialState: state };
    act(() => root.render(<LocaleProvider><Harness key="retained-bonus-segments-v2.5" /></LocaleProvider>));
    expect(run.getState().config.wetland?.catalogVersion).toBe(6);
    expect(run.getState().descriptor).toMatchObject({
      simulationVersion: '2.5.0', generatorVersion: '2.5.0', configId: 'dd-v2-bonus-segments-v1',
    });
  });

  it('resumes a frozen 2.4 coin-course run without changing its identity', () => {
    const config = COIN_COURSE_DEFAULT_CONFIG;
    const state = createRun(createRunDescriptor({ runId: 'retained-coin-course-v2.4', seed: 44 }, config), config);
    options = { config, initialState: state };
    act(() => root.render(<LocaleProvider><Harness key="retained-coin-course-v2.4" /></LocaleProvider>));
    expect(run.getState().config.wetland?.catalogVersion).toBe(5);
    expect(run.getState().descriptor).toMatchObject({
      simulationVersion: '2.4.0', generatorVersion: '2.4.0', configId: 'dd-v2-coin-course-v1',
    });
  });

  it('recovers an existing catalog-2 varied-obstacle run without changing its identity', () => {
    const state = createRun(createRunDescriptor({ runId: 'retained-varied-obstacles-v2', seed: 3 }, VARIED_OBSTACLE_DEFAULT_CONFIG), VARIED_OBSTACLE_DEFAULT_CONFIG);
    options = { config: VARIED_OBSTACLE_DEFAULT_CONFIG, initialState: state };
    act(() => root.render(<LocaleProvider><Harness key="retained-varied-obstacles-v2" /></LocaleProvider>));
    expect(run.getState().config.wetland?.catalogVersion).toBe(2);
    expect(run.getState().descriptor).toMatchObject({
      simulationVersion: '2.1.0', generatorVersion: '2.1.0', configId: 'dd-v2-varied-obstacles-v1',
    });
  });

  it('recovers an existing catalog-1 run without changing its identity', () => {
    const state = createRun(createRunDescriptor({ runId: 'retained-wetland-v2', seed: 3 }, WETLAND_DEFAULT_CONFIG), WETLAND_DEFAULT_CONFIG);
    options = { config: WETLAND_DEFAULT_CONFIG, initialState: state };
    act(() => root.render(<LocaleProvider><Harness key="retained-wetland-v2" /></LocaleProvider>));
    expect(run.getState().config.wetland?.catalogVersion).toBe(1);
    expect(run.getState().descriptor).toMatchObject({
      simulationVersion: '2.0.0', generatorVersion: '2.0.0', configId: 'dd-v2-wetland-v1',
    });
  });

  it('keeps the same active run and input sequence when language changes', () => {
    act(() => run.start());
    frame(17);
    const before = run.getState();
    expect(before.phase).toBe('RUNNING');
    act(() => changeLocale('en'));
    expect(run.getState()).toBe(before);
    frame(17);
    expect(run.getState().tick).toBe(before.tick + 1);
    expect(run.getState().descriptor).toEqual(before.descriptor);
    expect(run.getState().nextInputSequence).toBe(before.nextInputSequence);
  });

  it('records each applied simulation tick with its actual input batch, including empty ticks', () => {
    const onTick = vi.fn();
    options = { onTick };
    act(() => root.render(<LocaleProvider><Harness /></LocaleProvider>));
    act(() => run.start());
    frame(17);
    frame(17);

    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick.mock.calls.map(([, ticks]) => ticks)).toEqual([[{ sequence: 0, action: 'FLAP' }], []]);
  });

  it('stops the account simulation when its authoritative recorder fails', () => {
    options = { onTick: () => { throw new Error('trace write failed'); } };
    act(() => root.render(<LocaleProvider><Harness /></LocaleProvider>));
    act(() => run.start());
    frame(17);

    expect(run.getState().phase).toBe('READY');
    expect(run.runtimeError).toBe('simulationStoppedError');
    expect(run.rendererReady).toBe(false);
  });

  it('freezes account flight advancement at its active tick limit', () => {
    const onTick = vi.fn();
    options = { onTick, activeTickLimit: 2 };
    act(() => root.render(<LocaleProvider><Harness /></LocaleProvider>));
    act(() => run.start());
    frame(17);
    frame(17);
    frame(17);

    expect(run.phase).toBe('PAUSED');
    expect(run.getState().tick).toBe(2);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(run.flightCapReached).toBe(true);
  });

  it('discards flaps queued behind the tick that reaches the account cap', () => {
    const onTick = vi.fn();
    options = { onTick, activeTickLimit: 2 };
    act(() => root.render(<LocaleProvider><Harness /></LocaleProvider>));
    act(() => { run.start(); run.flap(); run.flap(); });
    frame(17);
    frame(50);

    expect(run.getState().tick).toBe(2);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick.mock.calls.map(([, inputs]) => inputs)).toEqual([
      [{ sequence: 0, action: 'FLAP' }],
      [{ sequence: 1, action: 'FLAP' }],
    ]);
  });

  it('starts from a complete Space key press before the next animation frame', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    });
    frame(1_000);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().nextInputSequence).toBe(1);
  });

  it('discards a queued READY flap if a modal opens before the next animation frame', () => {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
    expect(run.phase).toBe('READY');
    modalOpen = true;
    frame(17);
    expect(run.phase).toBe('READY');
    expect(run.getState().nextInputSequence).toBe(0);
    expect(callbacks.onFlap).toHaveBeenCalledTimes(1);
    modalOpen = false;
    frame(17);
    expect(run.phase).toBe('READY');
  });

  it.each(['Space', 'ArrowUp'])('leaves a focused native language select usable for %s', (code) => {
    const select = host.querySelector('select')!;
    select.focus();
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    act(() => select.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    act(() => select.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })));
    frame(17);
    expect(run.phase).toBe('READY');
    expect(run.getState().nextInputSequence).toBe(0);
    expect(callbacks.onFlap).not.toHaveBeenCalled();
  });

  it('does not carry a dying slow frame backlog into an immediate new run', () => {
    act(() => run.start());
    frame(17);
    for (let i = 0; i < 200 && run.getState().duck.y < run.getState().config.pipes.floorY - 40_000; i++) frame(17);
    expect(run.phase).toBe('RUNNING');
    frame(200);
    expect(run.phase).toBe('DEAD');
    act(() => run.restart());
    act(() => run.start());
    frame(17);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().tick).toBe(1);
  });

  it('does not charge idle time to the first queued flap or an explicit resume', () => {
    act(() => run.start());
    frame(1_000);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().tick).toBe(1);
    act(() => run.pause());
    act(() => run.start());
    frame(1_000);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().tick).toBe(2);
  });

  it('can start after a long idle frame and restart after a long dead frame', () => {
    frame(1_000);
    act(() => run.start());
    frame(17);
    expect(run.phase).toBe('RUNNING');
    for (let i = 0; i < 200 && run.phase !== 'DEAD'; i++) frame(17);
    expect(run.phase).toBe('DEAD');
    frame(1_000);
    act(() => { run.restart(); });
    act(() => run.start());
    frame(17);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().tick).toBe(1);
  });

  it('pauses overload without advancing that frame and discards queued flaps before explicit resume', () => {
    act(() => run.start());
    frame(17);
    frame(200);
    const before = run.getState();
    act(() => { run.flap(); run.flap(); });
    frame(150);
    expect(run.phase).toBe('PAUSED');
    expect(run.getState().tick).toBe(before.tick);
    expect(run.getState().nextInputSequence).toBe(before.nextInputSequence);
    frame(17);
    expect(run.getState().tick).toBe(before.tick);
    act(() => run.start());
    frame(17);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().nextInputSequence).toBe(before.nextInputSequence);
    act(() => run.flap());
    frame(17);
    expect(run.getState().nextInputSequence).toBe(before.nextInputSequence + 1);
  });

  it('discards a queued first flap when hidden before its first animation frame and requires explicit start on return', () => {
    act(() => run.start());
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(run.phase).toBe('READY');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    frame(17);
    frame(17);
    expect(run.phase).toBe('READY');
    expect(run.getState().nextInputSequence).toBe(0);
    act(() => run.start());
    frame(17);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().nextInputSequence).toBe(1);
  });

  it('does not accept inputs while hidden, including a new start', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => { run.start(); run.flap(); });
    frame(17);
    expect(run.phase).toBe('READY');
    expect(run.getState().nextInputSequence).toBe(0);
  });

  it('freezes each run config and uses the latest config and injected identity on restart', () => {
    const firstConfig = { ...PRIOR_DEFAULT_CONFIG, flight: { ...PRIOR_DEFAULT_CONFIG.flight, gravity: 321 } };
    const nextConfig = { ...PRIOR_DEFAULT_CONFIG, flight: { ...PRIOR_DEFAULT_CONFIG.flight, gravity: 654 } };
    const createIdentity = vi.fn()
      .mockReturnValueOnce({ runId: 'initial-injected', seed: 41 })
      .mockReturnValueOnce({ runId: 'injected-run', seed: 42 });
    options = { config: firstConfig, createIdentity };
    act(() => root.render(<Harness key="configured-run" />));
    const firstRun = run.getState();
    expect(firstRun.config.flight.gravity).toBe(321);
    expect(firstRun.descriptor.runId).toBe('initial-injected');
    options = { config: nextConfig, createIdentity };
    act(() => root.render(<Harness key="configured-run" />));
    expect(run.getState()).toBe(firstRun);
    expect(run.getState().config.flight.gravity).toBe(321);
    act(() => run.restart());
    expect(run.getState().config.flight.gravity).toBe(654);
    expect(run.getState().descriptor.runId).toBe('injected-run');
    expect(createIdentity).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(run.getState().config)).toBe(true);
  });

  it('delivers complete simulation event batches once in their simulation order', () => {
    const onEvents = vi.fn();
    options = { onEvents };
    act(() => root.render(<LocaleProvider><Harness /></LocaleProvider>));
    act(() => run.start());
    frame(17);
    const batches = onEvents.mock.calls.map(([events]) => events as readonly GameEvent[]);
    const delivered = batches.flat();
    expect(delivered.map((event) => event.type)).toEqual(['RunStarted']);
    expect(delivered[0]).toMatchObject({ type: 'RunStarted', runId: run.getState().descriptor.runId, tick: 1 });
    expect(new Set(delivered).size).toBe(delivered.length);
  });

  it('delivers scoring and collection in tick order and completion only once', () => {
    const onEvents = vi.fn();
    const config: GameConfig = {
      ...PRIOR_DEFAULT_CONFIG,
      starSchedule: null,
      challenges: null,
      pipes: {
        ...PRIOR_DEFAULT_CONFIG.pipes, safeLeadIn: 51_000, horizon: 51_000,
        gapMinCenter: 280_000, gapMaxCenter: 280_000, gapHeight: 400_000,
      },
      spawnNoneWeight: 0,
      collectibles: [{
        ...PRIOR_DEFAULT_CONFIG.collectibles[0]!, minPipeIndex: 0,
        minSpacingPipes: 0, weight: 1, radius: 60_000, amount: 3,
      }],
    };
    options = { config, onEvents, createIdentity: () => ({ runId: 'event-run', seed: 1 }) };
    act(() => root.render(<Harness key="event-run" />));
    act(() => run.acceptRenderer());
    frame(0);
    act(() => run.start());
    frame(17);
    const first = onEvents.mock.calls[0]![0] as readonly GameEvent[];
    expect(first).toEqual([
      { type: 'RunStarted', runId: 'event-run', tick: 1 },
      { type: 'PipePassed', runId: 'event-run', pipeId: 'pipe-0', score: 1, tick: 1 },
      { type: 'CurrencyCollected', runId: 'event-run', collectibleId: 'collectible-0', typeId: 'FEATHER', amount: 3, tick: 1 },
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    for (let i = 0; i < 200 && run.phase !== 'DEAD'; i++) frame(17);
    expect(run.phase).toBe('DEAD');
    const ended = onEvents.mock.calls.flatMap(([events]) => events as readonly GameEvent[])
      .filter(event => event.type === 'RunEnded');
    expect(ended).toEqual([{
      type: 'RunEnded', runId: 'event-run', score: run.getState().score,
      totals: { FEATHER: 3 }, tick: run.getState().tick,
    }]);
    const calls = onEvents.mock.calls.length;
    frame(17);
    act(() => run.flap());
    frame(17);
    expect(onEvents).toHaveBeenCalledTimes(calls);
    expect(callbacks.onRunEnded).toHaveBeenCalledTimes(1);
  });

  it('keeps gameplay running when an optional event observer fails', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    options = { onEvents: () => { throw Error('telemetry unavailable'); } };
    try {
      act(() => root.render(<LocaleProvider><Harness /></LocaleProvider>));
      act(() => run.start());
      frame(17);
      expect(run.runtimeError).toBe('');
      expect(run.rendererReady).toBe(true);
      expect(run.phase).toBe('RUNNING');
      frame(17);
      expect(run.getState().tick).toBe(2);
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      report.mockRestore();
    }
  });
});
