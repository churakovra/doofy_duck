// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGameAudio } from './useGameAudio';

const audio = vi.hoisted(() => ({
  unlockFromGesture: vi.fn(), setPreferences: vi.fn(), dispose: vi.fn(),
  setPhase: vi.fn(), flap: vi.fn(), pickup: vi.fn(), death: vi.fn(),
}));
vi.mock('./audio', () => ({
  createGameAudio: () => audio,
  loadAudioPreferences: () => ({ sound: false, music: false }),
  saveAudioPreferences: vi.fn(),
}));

it('unlocks audio within a keyboard click activation when enabling playback', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  function Harness() {
    const controller = useGameAudio();
    return <button onClick={() => controller.toggle('music')}>Music</button>;
  }
  try {
    act(() => root.render(<Harness />));
    act(() => {
      // Enter activates a button via click, without field pointer events.
      host.querySelector('button')!.click();
      expect(audio.unlockFromGesture).toHaveBeenCalledTimes(1);
    });
    expect(audio.setPreferences).toHaveBeenLastCalledWith({ sound: false, music: true });
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});
