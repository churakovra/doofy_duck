# Audio module implementation and integration handoff

## Public API

`apps/web/src/audio.ts` exports exactly the following integration surface:

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

`Phase` is type-only imported from the game simulation package. Preferences default to sound/music enabled and use the separate versioned local-storage key `doofy-duck.audio-preferences.v1`; malformed, blocked, or unavailable storage falls back safely. The factory does not construct an `AudioContext`. `unlockFromGesture()` creates/resumes it lazily and catches synchronous/asynchronous browser failures. Calling it from a trusted activation event is required; do not use programmatic evaluation as proof of autoplay unlock.

The controller synthesizes original short descending triangle-wave flap/whoosh, two-note pickup, soft falling death cue, and a quiet 16-note sine melody loop. It uses small gain envelopes, caps active SFX voices at six, schedules music only while RUNNING, and clears nodes/timers on mute, phase changes, hidden-page transitions, or disposal. Foregrounding alone does not restart sound. Audio failure is best-effort and must not affect simulation/gameplay.

## UI integration for parent owner

This subtask intentionally does not edit `Game.tsx`, CSS, or renderer. The UI owner should:

1. Construct one controller from `loadAudioPreferences()` and own its lifetime.
2. Provide separate persisted sound and music toggles through `setPreferences(...)`. Treat the toggle action itself as a possible activation: call `unlockFromGesture()` from its real click/key handler when enabling a channel, especially after mute or pause canceled the prior unlock.
3. Call `unlockFromGesture()` in real pointer-up/click and keyboard activation handlers; pointerdown alone may not unlock. The first accepted flap can call unlock then `flap()` immediately, since the first cue is intentionally best-effort if resume has not completed.
4. Call `setPhase(phase)` whenever authoritative phase changes. The transition to DEAD triggers its death cue once; don't also call `death()` for that same transition. On accepted flap call `flap()`; on each `CurrencyCollected`, call `pickup(event.typeId)`.
5. Call `dispose()` on component teardown. Do not show a guaranteed-playing state based only on stored preference or unlock request.

## Verification record

- TDD unit cycle: initial audio tests failed against missing implementation behavior (context was not created/resumed, saved preference did not round-trip, and active context/disposal behavior was absent). After implementation, `npx vitest run apps/web/test/audio.test.ts` passed **6/6**.
- `npx tsc --noEmit --strict --target ES2020 --moduleResolution bundler --module ESNext --lib ES2020,DOM apps/web/src/audio.ts` and ESLint on the owned TS files passed. The full app TypeScript check currently fails in unowned `GameCanvas.tsx` at lines 138, 139, and 215 (`effectsGraphic` is not defined).
- Browser tests are in `apps/web/test/audio.browser.spec.ts`: one uses a real Playwright click event (not evaluate-as-gesture or autoplay-bypass flags) and instruments context state/audio-node graph; another checks non-zero samples from `OfflineAudioContext` rendering. These tests establish only their local Chromium outcomes, not human-audible output or Telegram mobile behavior.
- Remaining gates: parent integration/full suite and manual verification on Telegram iOS/Android and physical audio output, including foreground/background recovery. No Telegram-device test or human listening test is claimed here.
- The repository-wide `npm test` was attempted but is not green in the current shared workspace: Vitest is collecting Playwright `*.browser.spec.ts` files as unit suites (including this one and `newfeel.browser.spec.ts`), and `apps/web/src/feel.test.ts` currently fails `createRun` config identity validation. This subtask did not change shared test configuration or the other owner's files.
