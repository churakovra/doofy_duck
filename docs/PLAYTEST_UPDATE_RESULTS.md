# Playtest update — implementation and verification

> Historical verification for the prior speed ruleset. See [ARCADE_FIXES_RESULTS.md](ARCADE_FIXES_RESULTS.md) for the current checkout results.

Status: implemented and locally verified. Not a production release. Final independent follow-up review remains unapproved because the reviewer provider returned HTTP429 (usage limit); no successful verdict was returned.

## Delivered

- Cumulative local FEATHER/GAME_STAR wallet, distinct completed-run earnings, exactly-once settlement within the bounded local run-ID history, safe-integer validation, restart/reload persistence and explicit non-persistence notices. These are local in-game units, not Telegram XTR or redeemable rewards. Earlier unsaved runs cannot be reconstructed.
- Native exclusive Web Lock permits one persistent gameplay writer per origin. A competing tab cannot start; close the owner and reload the second tab to transfer ownership. The wallet is read after acquiring ownership. Unsupported/denied locking or unavailable storage permits memory-only play with no unlocked settlement writes.
- Deterministic active-time speed ramp in TypeScript and Go:144→288pixels/second over90seconds, capped. Pause freezes progress and restart resets it. No hidden death timer or promise that skilled survival is impossible.
- Renderer-only velocity tilt, wing/flap pulse, mild squash/stretch, parallax and bounded effects. Hitboxes, flight physics and game RNG remain authoritative and unchanged by presentation. Reduced motion suppresses extra effects.
- Original procedural Web Audio flap/pickup/death cues and quiet music loop. Lazy gesture unlock, separate saved controls, pause/background handling and disposal. Repeated same-phase notifications no longer cut off the death cue.

## Versions and parity

Internal simulationVersion1.1.0; generatorVersion1.0.0; default configId `dd-v1-speed-v1`. Shared fixture revision `foundation-speed-1`:12cases,30operations. The raw JSON comparison retains state/event field presence rather than normalizing expectations through Go structs. Valid speed values and the reviewed default reachability witness remain covered by simulation tests.

## Executed integration verification

Last full parent-run verification:2026-10-14, approximately20:11MSK, on this macOS development host.

| Command | Actual result |
| --- | --- |
| `npm run check` | PASS: typecheck, lint,117Vitest tests, Go tests, production build,15Chromium browser tests |
| `npm run test:parity` | PASS:23fixture/harness tests and native Go tests |
| `npm run test:go:race` | PASS |
| `go -C services/core/simulation vet ./...` | PASS |

The unit-test process emits Node's experimental localStorage warning; it did not fail the checks. Browser storage, blocked-storage behavior and reload persistence were exercised separately.

Browser evidence includes positive FEATHER collection and settlement followed by reload (not just a seeded zero-gain balance), two-page wallet ownership transfer, real Game start-button native AudioContext unlock, and non-zero offline waveform output from the shipped controller's flap path. Flight capture uses controlled60Hz frames and asserts RUNNING at capture, avoiding an overload-induced pause being mistaken for a rendering failure. Browser specs are excluded from Vitest and discovered by Playwright.

`docs/web-wallet-death.png` shows the tested positive earnings summary and cumulative wallet; its seeded balances are test data, not an actual account or production funds.

## Review disposition

Initial independent reviews identified the cross-tab lost update and unchecked public TypeScript speed helper. Both were corrected with focused regressions. Public `worldSpeedAt` now validates config and rejects fractional/nonfinite/unsafe or over-limit ticks; zero and negative safe-integer ticks retain Go's base-speed behavior. Additional parent behavioral RED/GREEN caught and fixed the repeated-death-phase audio cutoff.

The final independent follow-up task failed with provider HTTP429 before returning a verdict. Passing automated checks and parent source inspection are not being represented as an independent approval. Resume that narrow review when capacity is available; do not treat the earlier failed reviews as approvals.

## Remaining acceptance gates

- Owner gameplay assessment of speed, feel, effects and sound/music taste.
- Actual Telegram iOS/Android/desktop and physical audio-output validation, including background/foreground and device mute behavior.
- Named-device performance and heap measurements before public v1 acceptance.
- Final independent follow-up review described above.
- No new clean-source-copy or remote CI execution was performed for this update; the results above are from this existing local workspace.

No commit, push, public deployment, payment/account integration or valuable reward system was performed for this update. Start/use the localhost app as documented in README.md; the development app is on `http://127.0.0.1:4173/`.
