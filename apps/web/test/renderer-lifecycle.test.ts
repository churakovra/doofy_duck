import { describe, expect, it } from 'vitest';
import { serializeRendererLifecycle } from '../src/GameCanvas';

describe('renderer lifecycle serialization', () => {
  it('waits for an in-flight initialization and its disposal before the next initialization', async () => {
    const events: string[] = [];
    let finishFirstInit!: () => void;
    const firstInit = new Promise<void>((resolve) => { finishFirstInit = resolve; });

    const first = serializeRendererLifecycle(async () => {
      events.push('first:init:start');
      await firstInit;
      events.push('first:init:finish');
    });
    const staleCleanup = serializeRendererLifecycle(() => { events.push('first:destroy'); });
    const second = serializeRendererLifecycle(() => { events.push('second:init'); });

    await Promise.resolve();
    expect(events).toEqual(['first:init:start']);
    finishFirstInit();
    await Promise.all([first, staleCleanup, second]);

    expect(events).toEqual([
      'first:init:start',
      'first:init:finish',
      'first:destroy',
      'second:init',
    ]);
  });
});
