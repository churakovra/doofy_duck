import type { Phase } from '../../../packages/game-sim/src/index';

export interface AudioPreferences { sound: boolean; music: boolean }
export interface GameAudio {
  unlockFromGesture(): void;
  setPreferences(prefs: AudioPreferences): void;
  setPhase(phase: Phase): void;
  flap(): void;
  pickup(typeId: string): void;
  death(): void;
  dispose(): void;
}

const STORAGE_KEY = 'doofy-duck.audio-preferences.v1';
const DEFAULTS: AudioPreferences = { sound: true, music: true };
const MAX_SFX = 6;
const MUSIC_NOTES = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46, 523.25, 659.25, 783.99, 1046.5, 880, 783.99, 659.25, 587.33];

function checkedPreferences(value: unknown): AudioPreferences | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const prefs = value as Record<string, unknown>;
  return typeof prefs.sound === 'boolean' && typeof prefs.music === 'boolean'
    ? { sound: prefs.sound, music: prefs.music }
    : undefined;
}

export function loadAudioPreferences(): AudioPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return checkedPreferences(JSON.parse(raw)) ?? { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function saveAudioPreferences(prefs: AudioPreferences): void {
  try {
    const checked = checkedPreferences(prefs);
    if (checked) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(checked));
  } catch { /* Storage may be unavailable; audio preferences are non-critical. */ }
}

export function createGameAudio(initialPrefs: AudioPreferences = loadAudioPreferences()): GameAudio {
  let prefs = checkedPreferences(initialPrefs) ?? { ...DEFAULTS };
  let phase: Phase = 'READY';
  let context: AudioContext | undefined;
  let disposed = false;
  let gestureRequested = false;
  let musicTimer: ReturnType<typeof setTimeout> | undefined;
  let musicIndex = 0;
  let visibilitySuspended = false;
  const sfxNodes: AudioScheduledSourceNode[] = [];
  const musicNodes: AudioScheduledSourceNode[] = [];

  const canPlay = () => !disposed && !document.hidden && context?.state === 'running';
  const stopNodes = (nodes: AudioScheduledSourceNode[]) => {
    for (const node of nodes.splice(0)) {
      try { node.stop(); } catch { /* Already ended. */ }
      try { node.disconnect(); } catch { /* Context may already be closed. */ }
    }
  };
  const stopMusic = () => {
    if (musicTimer !== undefined) clearTimeout(musicTimer);
    musicTimer = undefined;
    stopNodes(musicNodes);
  };
  const makeContext = (): AudioContext | undefined => {
    if (context || disposed) return context;
    try {
      const Ctor = globalThis.AudioContext;
      if (!Ctor) return undefined;
      context = new Ctor();
      return context;
    } catch { return undefined; }
  };
  const playTone = (frequency: number, duration: number, volume: number, nodes: AudioScheduledSourceNode[], wave: OscillatorType = 'sine', sweepTo?: number) => {
    if (!canPlay() || !context) return;
    if (nodes === sfxNodes && nodes.length >= MAX_SFX) {
      const oldest = nodes.shift();
      try { oldest?.stop(); oldest?.disconnect(); } catch { /* no-op */ }
    }
    try {
      const now = context.currentTime;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(frequency, now);
      if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(context.destination);
      osc.onended = () => {
        try { osc.disconnect(); gain.disconnect(); } catch { /* no-op */ }
        const index = nodes.indexOf(osc);
        if (index >= 0) nodes.splice(index, 1);
      };
      nodes.push(osc);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch { /* Audio is an optional enhancement. */ }
  };
  const playDeathCue = () => {
    if (!prefs.sound || phase !== 'DEAD' || !canPlay()) return;
    playTone(330, 0.18, 0.05, sfxNodes, 'sine');
    playTone(220, 0.28, 0.045, sfxNodes, 'triangle');
  };
  const scheduleMusicNote = () => {
    musicTimer = undefined;
    if (!canPlay() || !prefs.music || phase !== 'RUNNING') return;
    const frequency = MUSIC_NOTES[musicIndex++ % MUSIC_NOTES.length]!;
    playTone(frequency, 0.29, 0.018, musicNodes, 'sine');
    musicTimer = setTimeout(scheduleMusicNote, 340);
  };
  const syncMusic = () => {
    if (canPlay() && gestureRequested && prefs.music && phase === 'RUNNING') {
      if (musicTimer === undefined) scheduleMusicNote();
    } else stopMusic();
  };
  const onVisibility = () => {
    if (document.hidden) {
      gestureRequested = false;
      visibilitySuspended = true;
      stopMusic();
      stopNodes(sfxNodes);
      try { void context?.suspend().catch(() => undefined); } catch { /* no-op */ }
    } else if (visibilitySuspended) {
      // Do not resume on visibility alone; browser policy may require a fresh gesture.
      visibilitySuspended = false;
      stopMusic();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    unlockFromGesture() {
      if (disposed || document.hidden) return;
      gestureRequested = true;
      const ctx = makeContext();
      if (!ctx || ctx.state === 'closed') return;
      try {
        void ctx.resume().then(() => {
          if (disposed || !gestureRequested || document.hidden) return;
          syncMusic();
        }).catch(() => { /* Next real user gesture may retry. */ });
      } catch { /* Resume can fail synchronously in embedded browsers. */ }
    },
    setPreferences(next) {
      const valid = checkedPreferences(next);
      if (!valid || disposed) return;
      prefs = valid;
      saveAudioPreferences(prefs);
      if (!prefs.sound) stopNodes(sfxNodes);
      syncMusic();
    },
    setPhase(next) {
      if (disposed || !['READY', 'RUNNING', 'PAUSED', 'DEAD'].includes(next)) return;
      // The simulation callback and React phase effect may report one transition twice.
      if (next === phase) return;
      const wasDead = phase === 'DEAD';
      phase = next;
      if (next !== 'RUNNING') {
        if (next === 'PAUSED' || next === 'DEAD') gestureRequested = false;
        stopMusic();
        stopNodes(sfxNodes);
      } else syncMusic();
      if (next === 'DEAD' && !wasDead) playDeathCue();
    },
    flap() {
      if (!prefs.sound || phase === 'PAUSED' || phase === 'DEAD' || !canPlay()) return;
      playTone(510, 0.11, 0.045, sfxNodes, 'triangle', 210);
    },
    pickup(typeId) {
      if (!prefs.sound || phase === 'PAUSED' || phase === 'DEAD' || !canPlay()) return;
      const high = typeId === 'GAME_STAR' ? 1046.5 : 880;
      playTone(high, 0.16, 0.07, sfxNodes, 'sine');
      playTone(high * 1.25, 0.2, 0.045, sfxNodes, 'sine');
    },
    death() {
      playDeathCue();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gestureRequested = false;
      document.removeEventListener('visibilitychange', onVisibility);
      stopMusic();
      stopNodes(sfxNodes);
      const oldContext = context;
      context = undefined;
      try { void oldContext?.close().catch(() => undefined); } catch { /* no-op */ }
    },
  };
}
