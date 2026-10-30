import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalState, createRun, createRunDescriptor, type InputFrame, type RunState } from '@doofy-duck/game-sim';
import { replayCheckpoint } from '../src/replay.js';

function initial(): RunState {
  return createRun(createRunDescriptor({ runId: 'replay-test', seed: 7 }));
}

describe('server checkpoint replay', () => {
  it.each(['curved-pipes', 'varied-base', 'base-bonus', 'dense-pipes', 'pressure-pipes'])('replays persisted %s fixture', (name) => {
    const fixture = JSON.parse(readFileSync(`contracts/simulation/${name}-replay-v1.json`, 'utf8')) as {
      cases: { initialState: RunState; operations: { frames: InputFrame[]; expectedState: RunState }[] }[];
    };
    const example = fixture.cases[0]!;
    const operation = example.operations[0]!;
    const replay = replayCheckpoint(example.initialState, example.initialState.tick, [operation.frames]);
    expect(canonicalState(replay.state)).toBe(canonicalState(operation.expectedState));
    expect(replay.activeTicks).toBe(example.initialState.tick + 1);
  });

  it('advances exact inputs and rejects invalid checkpoint and input sequences', () => {
    const state = initial();
    const result = replayCheckpoint(state, 0, [[{ sequence: 0, action: 'FLAP' }], [], []]);
    expect(result).toMatchObject({ activeTicks: 3, reason: '', state: { tick: 3, nextInputSequence: 1 } });
    expect(() => replayCheckpoint(state, 0, [])).toThrow();
    expect(() => replayCheckpoint(state, 0, Array.from({ length: 121 }, () => []))).toThrow();
    expect(() => replayCheckpoint(state, 0, [[]])).toThrow();
    expect(() => replayCheckpoint(state, 0, [[{ sequence: 1, action: 'FLAP' }]])).toThrow();
    expect(() => replayCheckpoint(state, 0, [[{ sequence: 0, action: 'FLAP', score: 99 }]])).toThrow();
  });

  it('stops on death and rejects ticks after death', () => {
    const running = replayCheckpoint(initial(), 0, [[{ sequence: 0, action: 'FLAP' }]]).state;
    const falling = { ...running, duck: { ...running.duck, y: running.config.pipes.floorY - 1, vy: 0 } };
    expect(replayCheckpoint(falling, 1, [[]])).toMatchObject({ activeTicks: 2, reason: 'death' });
    expect(() => replayCheckpoint(falling, 1, [[], []])).toThrow('ticks after run completion');
  });

  it('stops exactly at the active tick limit and rejects extra ticks', () => {
    const state = replayCheckpoint(initial(), 0, [[{ sequence: 0, action: 'FLAP' }]]).state;
    expect(replayCheckpoint(state, 9, [[]], 10)).toMatchObject({ activeTicks: 10, reason: 'flight_cap' });
    expect(() => replayCheckpoint(state, 9, [[], []], 10)).toThrow('ticks after run completion');
    expect(() => replayCheckpoint({ ...state, phase: 'PAUSED' }, 0, [[]])).toThrow();
  });
});
