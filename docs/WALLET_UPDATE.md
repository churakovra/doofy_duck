# Wallet and UI integration handoff

## Local wallet behavior

The web UI now stores a cumulative **local in-game wallet** under `doofy-duck:wallet:v1` in `localStorage`. The versioned record is:

```json
{"version":1,"balances":{"FEATHER":0,"GAME_STAR":0},"settledRunIds":[]}
```

Only one same-origin tab may own a persistent wallet writer. `wallet-session.ts` acquires a native exclusive Web Lock before gameplay input is accepted, reloads the latest wallet while holding that lock, and keeps the lock for the mounted gameplay session. A competing tab remains view-only for wallet play, shows a Russian close-the-other-tab/reload message, and cannot start or settle a run. Closing/unmounting releases the lock; a newly reloaded tab can then acquire ownership and load fresh balances. This is deliberate single-writer protection, not a read-modify-write transaction or cross-tab merge.

If Web Locks are unsupported or the lock request is denied, gameplay remains available with a memory-only wallet and no persistent writes. If wallet storage cannot be read or a save fails while holding the lock, the session likewise stays memory-only; a `null` storage argument explicitly disables settlement writes. Pending or secondary sessions cannot accept gameplay input. No timer, polling, or lease fallback is used.

Corrupt or unsupported stored records are not credited or repaired with invented prior earnings. They load as an empty, explicitly nonpersistent wallet. Historical runs that predate this wallet are not retroactively credited. GAME_STAR is labeled as a local game unit separate from Telegram XTR; this is not an account, redemption, gift, or server wallet.

The HUD shows cumulative FEATHER and GAME_STAR totals on every phase. The death card separately labels amounts earned in the just-completed run. Restart resets simulation/run state but preserves the cumulative wallet. Reload persistence is covered by the browser test with explicitly seeded test data.

## UI/audio integration

`Game.tsx` supplies bounded presentation-only flap, pickup, and death serials through the optional `GameCanvas.getFeedback` callback; no feedback is written into simulation state. It consumes `audio.ts` through the agreed factory/preferences API, creates/disposes the audio instance in an effect, unlocks on direct pointer/key/start/resume gestures, forwards accepted flap and simulation pickup/death events, follows phase changes, and exposes sound/music toggles during play. Buttons stop propagation so settings do not flap the game.

No Telegram client or physical-speaker behavior is claimed. Browser playback remains dependent on a real user gesture and browser/device policy.

## Verification

- RED (behavioral): `npm test -- --run apps/web/src/wallet-session.test.ts` failed the `throws synchronously` case with `Error: denied immediately` escaping from `acquireWalletSession`. GREEN: it now reports memory-only mode; the focused session tests pass.
- `npm test -- --exclude "apps/web/test/*.browser.spec.ts"` — 117 tests passed.
- `npm run typecheck`, `npm run lint` — passed.
- `npm run test:browser -- --grep "only one tab plays persistently|completed run settles into the local wallet"` — 2 Chromium tests passed: only one tab can start persistently; after owner close and reload, the second loads the stored balances; completed-run settlement also persists on reload.
- `npm test -- --run apps/web/src/wallet.test.ts apps/web/src/wallet-session.test.ts` — 11 tests passed, covering duplicate/invalid settlement, explicit no-write memory mode, unavailable/denied locks, busy ownership, delayed grants after disposal, and lock release on unmount.
- Web Lock request failure (including synchronous throw) and missing Web Locks select memory-only gameplay; a busy lock blocks play. No unlocked write fallback is permitted.

## Owned paths

`apps/web/src/Game.tsx`, `apps/web/src/wallet.ts`, `apps/web/src/wallet.test.ts`, `apps/web/src/wallet-session.ts`, `apps/web/src/wallet-session.test.ts`, `apps/web/test/wallet-session.browser.spec.ts`, and this document. Existing stylesheet and Playwright tests were not edited by this wallet-session fix. `storage.ts` was unchanged. No backend, renderer, simulation, fixtures, dependencies, or wallet server were added.
