import { describe, expect, it, vi } from 'vitest';
import { CheckpointBackoff } from './checkpoint-backoff';

describe('checkpoint retry deadline', () => {
  it('blocks every pump entry point until the shared deadline and resets for a new run', () => {
    vi.useFakeTimers();
    const backoff = new CheckpointBackoff(() => 0);
    expect(backoff.defer(60_000)).toBe(60_000);
    expect(backoff.canAttempt()).toBe(false);
    vi.advanceTimersByTime(59_999);
    expect(backoff.canAttempt()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(backoff.canAttempt()).toBe(true);
    backoff.reset('run-b');
    expect(backoff.canAttempt()).toBe(true);
    vi.useRealTimers();
  });
});
