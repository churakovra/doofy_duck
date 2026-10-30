# Foundation and extension boundaries

The [product vision](PRODUCT_VISION.md) targets a Telegram arcade game with
progression, cosmetic equipment, purchases, and later additional mechanics.
The current foundation is an account-backed game. This guide describes where to extend
implemented code; it does not specify those future features.

## Rules and runs

Import the simulation through `@doofy-duck/game-sim`. Its public entrypoint
remains stable while internal modules separate configuration, canonical identity,
generation, tick orchestration, and compatibility collectible helpers.

Configuration is data, not a callback into application code. A run owns an
immutable copy of its configuration and descriptor. Editing a preset cannot
change a run already in progress. `useGameRun` accepts an optional configuration
and identity factory; a restart snapshots the latest supplied configuration and
creates a new identity. Default callers retain existing rules and cryptographic
browser identity generation.

Default generation uses a versioned, data-driven challenge set with four-pipe
families and a bounded seeded pressure/recovery schedule. `GameConfig.challenges`
owns the family geometry and references; it is deep-copied with the rest of the
run configuration. Omitted or `null` challenges select the gap-only custom path
and normalize to the same configuration identity. Challenge metadata is part of
pipe state, while the renderer continues to consume the actual pipe geometry.

Change physics, scoring, generation, or pickup effects in the shared simulation.
Keep collision, scoring, generation, and collection ordering explicit. Follow
the [simulation contract](../contracts/simulation/README.md), add semantic tests
and review identities before changing observable rules.
Do not regenerate fixtures to hide a mismatch. New abilities need their own
state, timing, ordering, and replay design; a generic plugin engine is not part
of the current implementation.

Canonical identity uses JavaScript JSON string encoding and UTF-16 key ordering
for the simulation. Collectible IDs are arbitrary nonempty strings, including
names inherited by ordinary JavaScript objects; consumers must use own-property
lookups for dictionaries. Configuration weights use the safe-integer domain,
which is distinct from the slightly smaller simulation-counter domain.

## Presentation and equipment

`GameCanvas` owns Pixi initialization, cleanup, and frame scheduling. `scene.ts`
owns scene construction and drawing; `appearance.ts` contains renderer palettes.
Supply `GameAppearance` to change duck, background, pipe, and pickup colors.
Collectible art resolves the definition's `appearance` key, with a fallback for
unknown art. Neither appearance nor equipped cosmetics belongs in physics or
the simulation's configuration identity.

The renderer draws floor and ceiling boundaries from the run configuration.
Its current viewport remains 360 by 580 presentation pixels. A rule set intended
for a different world extent also needs a deliberately designed camera; accepting
a simulation configuration alone does not guarantee it fits the browser view.
The account shop resolves server-owned equipment IDs into procedural appearance.
The legacy local wardrobe and image helpers remain in the repository. They do not
control account ownership. See the [cosmetic authoring guide](COSMETICS.md).

## Events, statistics, and progress

`useGameRun` offers an optional `onEvents` observer for nonempty ordered simulation
event batches. It exposes complete `RunStarted`, `PipePassed`, `CurrencyCollected`,
and `RunEnded` payloads. Use this boundary for local telemetry and presentation
consumers rather than reconstructing gameplay facts from rendered positions.
Observers should be synchronous and lightweight. Observer exceptions are reported
without rewinding or stopping gameplay; this is not a delivery guarantee. Network
delivery needs a separate bounded transport and retry policy.

The account flow records input for Core verification. Verified completion facts
are delivered to Economy for settlement. Account balances and equipment are
server-owned. Legacy local progress helpers do not authorize account rewards or
purchases. See the [wallet contract](../contracts/http/economy-wallet-v1.md) and
[shop contract](../contracts/http/economy-shop-v1.md).

## Verification

Vitest resolves the simulation package to source so a clean checkout and edited
source cannot silently exercise missing or stale generated output. Production
builds still use the package's generated entrypoint. Routine verification is
`npm run check`.
Browser checks remain on demand. Regression tests cover custom identifiers,
canonical text, negative coordinate rounding, configuration ownership, hidden
input, renderer startup failures, palettes, and event delivery.
