import { describe, expect, it } from 'vitest';
import { finishAccountLogout } from './account-logout';

describe('account logout persistence cleanup', () => {
  it('waits for queued writes before clearing the account and releasing its writer lock', async () => {
    const events: string[] = [];
    let trace: unknown = undefined;
    let oldWriterLockHeld = true;
    let newWriterAcquired = false;
    let finishSave!: () => void;
    const save = new Promise<void>((resolve) => { finishSave = resolve; })
      .then(() => { trace = { saved: true }; events.push('save'); });
    const cleanup = finishAccountLogout(save, async () => {
      events.push('clear');
      trace = undefined;
    }, () => {
      events.push('release');
      oldWriterLockHeld = false;
      newWriterAcquired = true;
      events.push('new-owner');
    });

    expect(events).toEqual([]);
    expect(trace).toBeUndefined();
    expect(oldWriterLockHeld).toBe(true);
    expect(newWriterAcquired).toBe(false);
    finishSave();
    await cleanup;

    expect(events).toEqual(['save', 'clear', 'release', 'new-owner']);
    expect(trace).toBeUndefined();
    expect(oldWriterLockHeld).toBe(false);
    expect(newWriterAcquired).toBe(true);
  });

  it('releases the captured lock after a failed save or storage clear', async () => {
    const events: string[] = [];
    await finishAccountLogout(Promise.reject(new Error('save failed')), async () => {
      events.push('clear');
      throw new Error('clear failed');
    }, () => events.push('release'));
    expect(events).toEqual(['clear', 'release']);
  });
});
