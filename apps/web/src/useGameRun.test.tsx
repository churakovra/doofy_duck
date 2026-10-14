// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameRun } from './useGameRun';

let run: ReturnType<typeof useGameRun>;
let frameId: number;
let now: number;
let frames: Map<number, FrameRequestCallback>;
let root: ReturnType<typeof createRoot>;
const callbacks = {
  onFlapUnlock: vi.fn(), onFlap: vi.fn(), onPickup: vi.fn(),
  onPhaseChange: vi.fn(), onRunEnded: vi.fn(),
};
function Harness() { run = useGameRun(() => true, callbacks); return null; }
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
  frameId = 0;
  now = 0;
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
  act(() => run.acceptRenderer());
  frame(0);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('run clock integration', () => {
  it('starts from a complete Space key press before the next animation frame', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    });
    frame(1_000);
    expect(run.phase).toBe('RUNNING');
    expect(run.getState().nextInputSequence).toBe(1);
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
});
