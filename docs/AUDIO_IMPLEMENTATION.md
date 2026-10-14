# Audio implementation

## Public API

`apps/web/src/audio.ts` exports the `AudioPreferences` and `GameAudio` types and the following controller functions:

```ts
interface AudioPreferences { sound: boolean; music: boolean }
loadAudioPreferences(): AudioPreferences
saveAudioPreferences(prefs: AudioPreferences): void
createGameAudio(prefs?): {
  unlockFromGesture(): void;
  setPreferences(prefs: AudioPreferences): void;
  setPhase(phase: Phase): void;
  flap(): void;
  pickup(typeId: string): void;
  death(): void;
  dispose(): void;
}
```

`Phase` comes from the simulation. Preferences default to sound/music enabled and use the separate versioned local-storage key `doofy-duck.audio-preferences.v1`; malformed, blocked, or unavailable storage falls back safely. The factory does not construct an `AudioContext`. `unlockFromGesture()` creates/resumes it lazily and catches synchronous/asynchronous browser failures. Calling it from a trusted activation event is required; do not use programmatic evaluation as proof of autoplay unlock.

The controller synthesizes original short descending triangle-wave flap/whoosh, two-note pickup, soft falling death cue, and a quiet 16-note sine melody loop. It uses small gain envelopes, caps active SFX voices at six, schedules music only while RUNNING, and clears nodes/timers on mute, phase changes, hidden-page transitions, or disposal. Foregrounding alone does not restart sound. Audio failure is best-effort and must not affect simulation/gameplay.

## UI integration

`useGameAudio.ts` owns the controller and saved preferences; `Game.tsx` connects
gestures, phase changes, and gameplay events. Integration requirements:

1. Construct one controller from `loadAudioPreferences()` and own its lifetime.
2. Provide separate persisted sound and music toggles through `setPreferences(...)`. Treat the toggle action itself as a possible activation: call `unlockFromGesture()` from its real click/key handler when enabling a channel, especially after mute or pause canceled the prior unlock.
3. Call `unlockFromGesture()` in real pointer-up/click and keyboard activation handlers; pointerdown alone may not unlock. The first accepted flap can call unlock then `flap()` immediately, since the first cue is intentionally best-effort if resume has not completed.
4. Call `setPhase(phase)` whenever authoritative phase changes. The transition to DEAD triggers its death cue once; don't also call `death()` for that same transition. On accepted flap call `flap()`; on each `CurrencyCollected`, call `pickup(event.typeId)`.
5. Call `dispose()` on component teardown. Do not show a guaranteed-playing state based only on stored preference or unlock request.

## Checks and remaining validation

Unit tests are in `apps/web/test/audio.test.ts`; browser cases are in
`apps/web/test/audio.browser.spec.ts`. They exercise context activation, saved
preferences, lifecycle, node cleanup, and offline rendering. Browser evidence
does not establish human-audible output or Telegram mobile behavior.

Manual Telegram iOS/Android and physical output validation remains open,
including foreground/background recovery. See the
[audio research](TELEGRAM_AUDIO_RESEARCH.md) for the browser-policy basis and
[root README](../README.md) for check commands.
