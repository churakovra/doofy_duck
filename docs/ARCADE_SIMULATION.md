# Arcade simulation rules

The TypeScript simulation runs in the browser and in Core. Core issues a run
descriptor and replays each submitted input against the issued rules. The
descriptor pins the seed, simulation version, generator version and configuration
ID. See the [run contract](../contracts/http/core-run-v1.md) for checkpoint
submission and verification.

## Current course

New runs use simulation/generator `3.3.0`, configuration
`dd-v3-random-pipes-v1` and encounter catalog 14. Ordinary pipe centers are
126,400 milli-pixels apart. The first pipe has a safe lead-in. Each later
ordinary gap center is sampled by seed and pipe index within the legal range
of 110,000–450,000 and within 140,000 of the previous center. Moves of at least
30,000 are preferred where the configured bounds allow them.

The first hard bonus segment starts at block 6, 7 or 8 and repeats every
seven blocks. Its three gates take a seeded ascent, descent or slalom shape.
The wider interval after the third gate holds a three-coin reward. Ordinary
coins and independently scheduled in-game Stars remain available. Only
contact with a pickup adds it to the run's totals.

## Step and replay

- The simulation uses integer milli-pixels and advances at 60 ticks per
  second. First FLAP starts a READY run. PAUSED and DEAD are inert.
- On a flap, the impulse sets vertical velocity. The same tick applies
  gravity and caps fall speed before updating position. World speed ramps
  with active ticks and score up to the issued cap. A newly scored pipe
  affects speed from the following tick.
- A cleared station scores once. Collision takes priority over scoring and
  pickup collection on a lethal tick. Generation uses the seed and pipe
  index, independent of the player's pickups.
- Use [config.ts](../packages/game-sim/src/config.ts) for current parameters,
  [generation.ts](../packages/game-sim/src/generation.ts) for geometry and
  rewards, and [simulation.ts](../packages/game-sim/src/simulation.ts) for
  physics and event ordering.

## Compatibility and checks

Issued runs keep their original geometry, event names and serialized state.
The built-in registry resolves historical version/configuration pairs; custom
configuration IDs encode canonical rules. Keep the legacy pattern catalog
and normalization stable because they participate in that identity.

Run `npm test -- packages/game-sim/test` for geometry, collision, pickup and
replay coverage. The [fixture guide](../contracts/simulation/README.md)
describes versioned fixtures and deliberate regeneration. Playability and
Telegram device behavior still require playtesting.
