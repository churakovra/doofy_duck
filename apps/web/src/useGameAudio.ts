import { useCallback, useEffect, useRef, useState } from 'react';
import type { Phase } from '@doofy-duck/game-sim';
import { createGameAudio, loadAudioPreferences, saveAudioPreferences, type AudioPreferences, type GameAudio } from './audio';

export function useGameAudio() {
  const [preferences, setPreferences] = useState<AudioPreferences>(loadAudioPreferences);
  const audioRef = useRef<GameAudio | null>(null);

  useEffect(() => {
    const audio = createGameAudio(preferences);
    audioRef.current = audio;
    return () => {
      audio.dispose();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.setPreferences(preferences);
    saveAudioPreferences(preferences);
  }, [preferences]);

  const unlockFromGesture = useCallback(() => audioRef.current?.unlockFromGesture(), []);
  const setPhase = useCallback((phase: Phase) => audioRef.current?.setPhase(phase), []);
  const flap = useCallback(() => audioRef.current?.flap(), []);
  const pickup = useCallback((typeId: string) => audioRef.current?.pickup(typeId), []);
  const toggle = useCallback((key: keyof AudioPreferences) => {
    // Keep resume inside the activation handler, including keyboard clicks.
    if (!preferences[key]) audioRef.current?.unlockFromGesture();
    setPreferences((current) => ({ ...current, [key]: !current[key] }));
  }, [preferences]);

  return { preferences, toggle, unlockFromGesture, setPhase, flap, pickup };
}
