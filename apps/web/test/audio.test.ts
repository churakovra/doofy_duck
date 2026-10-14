/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameAudio, loadAudioPreferences, saveAudioPreferences } from '../src/audio';

class FakeParam {
  value = 0;
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
  cancelScheduledValues() {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  connect() { return this; }
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  constructor() { FakeAudioContext.instances.push(this); }
  createGain = vi.fn(() => new FakeNode());
  createOscillator = vi.fn(() => new FakeNode());
  createBufferSource = vi.fn(() => new FakeNode());
  createBuffer(_channels: number, frames: number) { return { duration: frames / 44100, getChannelData: () => new Float32Array(frames) }; }
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}
const OriginalAudioContext = globalThis.AudioContext;
afterEach(() => {
  FakeAudioContext.instances = [];
  if (OriginalAudioContext) globalThis.AudioContext = OriginalAudioContext;
  else Reflect.deleteProperty(globalThis, 'AudioContext');
  localStorage.clear();
});

describe('game audio', () => {
  it('does not create a context until a gesture unlock', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const audio = createGameAudio();
    expect(FakeAudioContext.instances).toHaveLength(0);
    audio.setPhase('RUNNING');
    expect(FakeAudioContext.instances).toHaveLength(0);
    audio.unlockFromGesture();
    await vi.waitFor(() => expect(FakeAudioContext.instances[0]?.resume).toHaveBeenCalledOnce());
    audio.dispose();
  });

  it('persists preferences and safely defaults when storage is blocked', () => {
    expect(loadAudioPreferences()).toEqual({ sound: true, music: true });
    saveAudioPreferences({ sound: false, music: true });
    expect(loadAudioPreferences()).toEqual({ sound: false, music: true });
    const getter = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); });
    expect(loadAudioPreferences()).toEqual({ sound: true, music: true });
    getter.mockRestore();
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    expect(() => saveAudioPreferences({ sound: true, music: false })).not.toThrow();
    setter.mockRestore();
  });

  it('bounds overlapping SFX voices by stopping the oldest voices', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const audio = createGameAudio({ sound: true, music: false });
    audio.unlockFromGesture();
    await vi.waitFor(() => expect(FakeAudioContext.instances[0]?.state).toBe('running'));
    audio.setPhase('RUNNING');
    const ctx = FakeAudioContext.instances[0]!;
    for (let i = 0; i < 20; i += 1) audio.pickup(i % 2 ? 'FEATHER' : 'GAME_STAR');
    const sfxNodes = ctx.createOscillator.mock.results.map((result) => result.value as FakeNode);
    expect(sfxNodes).toHaveLength(40);
    expect(sfxNodes.filter((node) => node.disconnect.mock.calls.length > 0)).toHaveLength(34);
    audio.dispose();
  });

  it('requires a fresh gesture after pause before music can restart', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const audio = createGameAudio();
    audio.unlockFromGesture();
    await vi.waitFor(() => expect(FakeAudioContext.instances[0]?.state).toBe('running'));
    audio.setPhase('RUNNING');
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.createOscillator).toHaveBeenCalled();
    ctx.createOscillator.mockClear();
    audio.setPhase('PAUSED');
    audio.setPhase('RUNNING');
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    audio.unlockFromGesture();
    await vi.waitFor(() => expect(ctx.createOscillator).toHaveBeenCalled());
    audio.dispose();
  });

  it('does not auto-resume after hidden-document suspension', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const audio = createGameAudio();
    audio.unlockFromGesture();
    await vi.waitFor(() => expect(FakeAudioContext.instances[0]?.state).toBe('running'));
    audio.setPhase('RUNNING');
    const ctx = FakeAudioContext.instances[0]!;
    ctx.createOscillator.mockClear();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.suspend).toHaveBeenCalledOnce();
    expect(ctx.state).toBe('suspended');
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resume).toHaveBeenCalledOnce();
    audio.flap();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    audio.dispose();
    hidden.mockRestore();
  });

  it('does not cut off the death cue when React repeats the same phase', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const audio = createGameAudio({ sound: true, music: false });
    audio.unlockFromGesture();
    await vi.waitFor(() => expect(FakeAudioContext.instances[0]?.state).toBe('running'));
    audio.setPhase('RUNNING');
    audio.setPhase('DEAD');
    const ctx = FakeAudioContext.instances[0]!;
    const cues = ctx.createOscillator.mock.results.map((result) => result.value as FakeNode);
    expect(cues).toHaveLength(2);
    audio.setPhase('DEAD');
    for (const cue of cues) {
      // One scheduled stop at the envelope's end, not another immediate stop.
      expect(cue.stop).toHaveBeenCalledOnce();
      expect(cue.disconnect).not.toHaveBeenCalled();
    }
    audio.dispose();
  });

  it('silences SFX and music when muted, paused, hidden, or disposed', async () => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    const audio = createGameAudio();
    audio.unlockFromGesture();
    await vi.waitFor(() => expect(FakeAudioContext.instances[0]?.state).toBe('running'));
    audio.setPhase('RUNNING');
    audio.flap();
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.createOscillator).toHaveBeenCalled();
    audio.setPreferences({ sound: false, music: false });
    audio.flap();
    audio.setPhase('PAUSED');
    document.dispatchEvent(new Event('visibilitychange'));
    audio.dispose();
    expect(ctx.close).toHaveBeenCalledOnce();
    audio.unlockFromGesture();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});
