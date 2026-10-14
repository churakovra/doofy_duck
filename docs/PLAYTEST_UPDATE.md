# Playtest update — wallet, speed, flight feel, and audio

> Historical: this report describes simulation 1.1.0 and the superseded speed rules. Current rules are in [ARCADE_SIMULATION.md](ARCADE_SIMULATION.md).

Status: owner-requested implementation scope. Supersedes fixed-speed/no-cumulative-wallet/no-audio assumptions in GAME_V1_SPEC.md for this iteration; does not approve server accounts, payouts, monetization, new activities, or final art.

## Required outcomes

1. Visible cumulative **local in-game wallet**, distinct from this run's collected amounts. Settle a completed run exactly once; preserve balances across restart/reload. Existing earlier run totals were not retained and cannot honestly be reconstructed. Unavailable/corrupt storage must not break play; do not claim durable saving when storage is blocked. GAME_STAR is not XTR or a redeemable server balance.
2. Smooth deterministic speed increase with active simulation time, not wall-clock time or purchases. Proposed first tuning:2400→4800 milli-pixels/tick over5400ticks (144→288pixels/s over90active seconds). Cap speed to preserve valid geometry; this makes play harder but does not guarantee every skilled run ends. Pause freezes progression; restart resets it.
3. Better impact/feel without extra gameplay systems: upward/downward tilt, wing motion/flap pulse, mild visual squash/stretch and small bounded air/pickup effects; readable parallax. Do not change authoritative hitboxes, flap physics, score, or random gameplay from renderer effects. Respect reduced motion; do not use aggressive screenshake or constant full-scene reconstruction as animation.
4. Research browser audio inside Telegram and implement flap/pickup/death cues plus a quiet original music loop. Lazy Web Audio initialization on real user gestures, touch-end/click/key activation compatibility, saved sound/music toggles, silence while paused/hidden/dead, cleanup, and graceful no-audio fallback. No copyrighted downloaded song, third-party audio service, new dependency or auto-playing sound on page load. Actual Telegram/mobile/speaker output remains an explicit device gate.

## Shared runtime contract

- Core implementation owns new pure helper `worldSpeedAt(config, tick)`: `speed + floor((maxSpeed-speed)*min(max(tick-1,0),rampTicks)/rampTicks)` for positive running ticks, initial speed for READY. Use checked bounded integer arithmetic in TS/Go. New PipeConfig fields: maxSpeed, rampTicks. No state field required for derived speed. Every moved pipe and existing collectible uses the same speed on a given tick; newly spawned items remain aligned.
- New simulationVersion is1.1.0; generatorVersion remains1.0.0. New default configId is `dd-v1-speed-v1`; custom exact-content identity rules remain. This is an internal unreleased ruleset version, not a public product release.
- Core exports remain compatible by name; consumers do not reimplement simulation.
- GameCanvas retains getState/onReady and gains OPTIONAL getFeedback callback returning `{flapSerial:number,pickupSerial:number,deathSerial:number}`. All values are presentation-only. Existing callers work without it. UI maintains these bounded serials; no feedback enters core or Go fixtures.
- Audio module exports AudioPreferences `{sound:boolean,music:boolean}`, loadAudioPreferences(), saveAudioPreferences(prefs), and createGameAudio(prefs?) returning methods: unlockFromGesture(), setPreferences(prefs), setPhase(phase), flap(), pickup(typeId), death(), dispose(). Methods are nonthrowing to callers, unlock starts/resumes only from direct gestures; factory must not create an AudioContext eagerly. Async failures are caught. No UI or simulation imports beyond type-only Phase.

## Agent ownership

A. Wallet/UI: apps/web/src/Game.tsx, style.css, storage.ts if needed, new wallet.ts/components, wallet unit tests and existing playwright.spec.ts; docs/WALLET_UPDATE.md. Integrate audio module when available and getFeedback; never create a duplicate audio implementation. If dependency file is not present at integration time, finish wallet changes and report specific glue left for parent rather than waiting/polling. No renderer/core edits.

B. Speed/Go: packages/game-sim/**, contracts/simulation/**, services/core/simulation/**, docs/SPEED_UPDATE.md. No UI/root edits. Implement rate helper, domain/range validation, ruleset IDs, TS/Go regressions and meaningful raw fixtures including speed boundaries/cap/pause-reset. Update generator/fixture tests/readme truthfully; no automatic blind golden regeneration. New speed arithmetic must reject overflow-prone configurations consistently. Recheck default reachability under actual changing speed and exact long-run survival, not the old93tick constant-contact claim.

C. Visual feel: GameCanvas.tsx and new feel.ts/render helpers, feel unit tests, docs/FLIGHT_FEEL.md. No Game.tsx, storage/audio/core/root changes. Do not infer approval of a new art style; enhance existing placeholders through motion. New callback is optional and side-effect-free. Preserve serialized Pixi init/destruction and all renderer-failure handling. TypeScript module/public getter names as specified above.

D. Audio/research: new audio.ts and optional small audio-only helper module, audio unit tests/new audio.browser.spec.ts, docs/TELEGRAM_AUDIO_RESEARCH.md and docs/AUDIO_IMPLEMENTATION.md. No Game.tsx/CSS/renderer/core/root edits. Provide exact integration handoff. Research primary Telegram HTML5 documentation and browser/Web Audio policy; distinguish generally supported capability from unverified specific Telegram client. Use retrieved pages, sources/evidence ledger, no invented links. Verify actual signal generation using OfflineAudioContext where available; autoplay test must use real browser click/key/tap, not evaluate-as-user-gesture or an autoplay-bypass launch flag.

## Discipline and acceptance

Read current source before edits, load TDD and relevant skills, use behavioral RED/GREEN and focused regressions. No global installs, new dependencies, Git actions, releases, secrets, bot/tunnel/payments. Run owned checks; concurrent integration may temporarily fail due to another owned path, report accurately. Never modify another agent's path or wait/poll for it. Parent integrates and reruns full checks plus independent review.

Wallet checks cover duplicate settlement, death/restart/reload, integer totals, missing/corrupt/blocked storage and clear visible labels. Speed checks cover initial/mid/cap, paused/restarted time, synchronized pipe/item displacement and raw TS/Go parity. Feel checks cover bounded effects, no core mutation, reduced-motion path and rendered screenshot. Audio checks cover lazy init, unlock, mute/preferences, phase/background silence and dispose, real browser context/signal evidence without claiming physical speaker/Telegram validation.
