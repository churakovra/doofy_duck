# Local wallet and progress

## Local wallet behavior

The web UI now stores a cumulative **local in-game wallet** under `doofy-duck:wallet:v1` in `localStorage`. The versioned record is:

```json
{"version":1,"balances":{"FEATHER":0,"GAME_STAR":0},"settledRunIds":[]}
```

Only one same-origin tab may own a persistent wallet writer. `wallet-session.ts` acquires a native exclusive Web Lock before gameplay input is accepted, reloads the latest wallet while holding that lock, and keeps the lock for the mounted gameplay session. A competing tab remains view-only for wallet play, shows a Russian close-the-other-tab/reload message, and cannot start or settle a run. Closing/unmounting releases the lock; a newly reloaded tab can then acquire ownership and load fresh balances. This is deliberate single-writer protection, not a read-modify-write transaction or cross-tab merge.

If Web Locks are unsupported or the lock request is denied, gameplay remains available with a memory-only wallet and no persistent writes. If wallet storage cannot be read or a save fails while holding the lock, the session likewise stays memory-only; a `null` storage argument explicitly disables settlement writes. Pending or secondary sessions cannot accept gameplay input. No timer, polling, or lease fallback is used.

Corrupt or unsupported stored records are not credited or repaired with invented prior earnings. They load as an empty, explicitly nonpersistent wallet. Only recorded, settled earnings are credited. GAME_STAR is labeled as a local game unit separate from Telegram XTR; this is not an account, redemption, gift, or server wallet.

The HUD shows cumulative FEATHER and GAME_STAR totals on every phase. The death card separately labels amounts earned in the just-completed run. Restart resets simulation/run state but preserves the cumulative wallet. Reload persistence is covered by the browser test with explicitly seeded test data.

## UI/audio integration

`Game.tsx` supplies bounded presentation-only flap, pickup, and death serials through the optional `GameCanvas.getFeedback` callback; no feedback is written into simulation state. `useGameAudio.ts` owns audio creation/disposal and saved preferences. `Game.tsx` connects direct activation gestures, accepted flap and simulation pickup/death events, phase changes, and sound/music controls to that hook. Buttons stop propagation so settings do not flap the game.

No Telegram client or physical-speaker behavior is claimed. Browser playback remains dependent on a real user gesture and browser/device policy.

## Checks

Use wallet/session unit tests and the production wallet browser cases. They cover
settlement deduplication, invalid records, memory-only fallback, tab ownership,
and reload persistence. Commands and current evidence are indexed in the
[documentation map](README.md).
