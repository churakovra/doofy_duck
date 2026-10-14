# Doofy Duck — gameplay foundation v1.0.0

Status: proposed acceptance specification based on the owner's latest scope correction. This is the target version, not an assertion that a game has been built or released. This document supersedes the broader near-term feature sequencing in the archived product direction notes. Commercial objectives and later feature ideas remain backlog context.

## Product definition

One endless, single-tap flight game. Fly between pipes, score one point per passed pipe pair, collect occasional currencies, die on collision, restart immediately. Build a small, predictable foundation rather than multiple activities or a generalized game framework.

The scope is the gameplay foundation, not the complete monetized Telegram product. No payment, gift-earning promise, economic simulator, finalized art system, daily route, or leaderboard is required to start implementing the core.

## 1. Flight and controls

- The duck has a fixed horizontal gameplay position; the world moves past it.
- Gravity acts downward. Each accepted press sets a configured upward velocity rather than adding unlimited acceleration. This is the proposed baseline flight feel to tune through playtesting.
- Pointer input supports mouse/touch; Space is the desktop alternative. A held key does not repeatedly flap, and one touch cannot also produce a duplicate mouse flap.
- Input is applied on simulation ticks with consistent ordering. No network round trip is needed for local flap feedback.
- One shared physics configuration defines gravity, flap velocity, maximum falling speed, and duck collision geometry. No character-specific physics or random input strength.

## 2. Endless pattern-based generation

- Start with a small catalog of authored pipe-gap sequences, selected by a seeded generator. A pattern is data describing pipe spacing and gap centers; it does not have its own engine.
- v1 uses stationary pipe pairs, a fixed world speed, and one gap size. Patterns provide variety through bounded gap positions and spacing. Difficulty ramps, moving obstacles, wind, branches, and biome-specific mechanics are deferred.
- The first obstacle has a configured safe lead-in. Pattern boundaries obey the same transition constraints as internal pipes.
- Reject unsafe parameter combinations and validate generated transitions under the actual physics. A visual gap alone is not evidence of reachability.
- Generate only a short horizon ahead and discard objects behind. Long runs must not accumulate the entire map or input history in live memory.
- No per-player adaptation, random physics, or difficulty changes based on score proximity, wallet, or purchases.

## 3. Collisions and death

- One stable, documented duck hitbox, independent of its sprite animation. Use simple fixed axis-aligned collision shapes initially.
- Proposed boundary rule: pipe, floor, or ceiling contact ends the run. Exact edge-touch behavior is specified consistently in browser and verifier.
- Collision handling must not miss an obstacle when it crosses the duck between simulation ticks; enforce safe movement bounds or use a swept collision test.
- On a lethal tick, death takes precedence over new points and pickups on that tick. Previously earned run points and collected items remain in the result.
- A run ends once. Inputs after death cannot add movement, score, or rewards. No shield or revive in v1.

## 4. Score

- The visible score is the count of passed pipe pairs, not elapsed time, pixels traveled, or collectible value.
- Award exactly one point when a pipe pair's trailing edge passes the duck and the run remains alive under the tick ordering above.
- Each pipe pair has a stable identifier and can score once only.
- Keep a personal best, updated from completed results. Local personal-best storage is a convenience, not a verified public leaderboard.
- Show current score during play; show final score, personal best, and Restart after death.

## 5. Collectibles and extension contract

Implement a minimal `Collectible` contract and two concrete types: `Feather` and `GameStar`. Class inheritance is acceptable; do not require a subclass for every cosmetic variant or value change. Keep ordinary tuning in data, and add a new behavior implementation only when behavior genuinely differs.

Each type has a small validated definition:

- Stable type ID and definition version.
- Spawn weight, minimum eligible pipe index, and minimum spacing in pipes.
- Pickup geometry and integer amount.
- Appearance reference.
- A deterministic pickup handler that emits a typed effect/event; it does not call the wallet, network, or renderer.

Spawn once per eligible pipe opportunity, with at most one collectible. A spawn table includes an explicit no-item weight. Apply spacing rules first, then deterministic selection; do not independently roll several currencies and resolve overlapping objects afterward. Check placement inside a safe passage away from solid obstacles. No distinct random system is needed for every parameter.

A pickup emits an event such as `{runId, collectibleId, typeId, amount, tick}` and removes that object. Reprocessing cannot collect it twice. Both currency types may initially share stationary behavior while differing in appearance, amount, and spawn configuration.

An eventual bonus can implement the same encounter/pickup contract, but its effect must be explicitly typed; not every bonus is a wallet credit. Do not implement temporary-effect stacking, inventories, or a booster framework in advance.

`GAME_STAR` is not Telegram XTR. In the standalone foundation, counters are development/practice values with no redemption promise. Account credit, if connected later, comes from verified gameplay facts under an approved Economy policy, never from a client-submitted balance. Making the foundation runnable does not require enabling live valuable rewards.

## 6. Minimal lifecycle and interface

States: READY → RUNNING → DEAD. PAUSED can be entered from RUNNING; resuming returns through a clear user action so the duck does not move unexpectedly.

- READY: duck, brief tap instruction, start affordance. The initial tap starts the run and produces the first flap exactly once.
- RUNNING: score and run collectible totals; no shop panels or pop-ups.
- PAUSED: no simulation, generation, rewards, or elapsed simulation ticks. Backgrounding/losing visibility enters pause. Discard stale held inputs on resume.
- DEAD: stable result and free immediate restart. No forced advertisement, purchase, or wait.
- Restart creates a new run identity and resets world/input/run counters. It never reopens the old run or duplicates its finalization.
- Settings remain minimal: mute if audio exists. Audio must not be required to understand gameplay.

## 7. Deterministic core, not a framework

Keep a pure simulation API: start a run from a descriptor, advance ticks with inputs, return state and typed events. It must not import React, PixiJS, Telegram, storage, or HTTP.

Minimal descriptor: run ID, seed, simulation version, generator version, and immutable configuration identity. Identical inputs and descriptors reproduce the same world and outcomes. Pin the chosen pattern catalog and collectible definitions through the configuration identity.

One specified gameplay PRNG is enough initially. Renderer effects must not consume it, and drawing extra frames cannot affect it. Future changes to spawn algorithms create a new configuration/version rather than changing old recorded runs.

Use a fixed simulation step independent of render frequency, explicit integer/fixed-point arithmetic and rounding, and a stable event order. Pause and overloaded-frame policies must not silently skip gameplay ticks or apply an unbounded catch-up on resume.

The TypeScript browser simulation and Go Core verifier must share golden input/output fixtures before scores or currencies are treated as server-authoritative. Seed reproducibility does not prevent automated legal play; this version does not claim bot-proof valuable rewards.

## 8. Rendering, resizing, and persistence

- Use one logical gameplay coordinate system. Different screen sizes scale/letterbox the presentation, not physics, collision geometry, or obstacle visibility advantages. Keep enough identical forward visibility across supported aspect ratios.
- Decouple drawing from simulation. Smooth presentation must not change results.
- One placeholder environment and one duck are sufficient. Previous visual boards are not selected production assets.
- Persist minimal local settings and completed personal-best results through a small storage adapter. A storage failure must not prevent the next run.
- Keep run collectibles distinct from durable account balances. No complete replay archive, account economy, or generic plugin system is required for the local foundation.

## 9. Explicit exclusions

Not in v1.0.0: public/friend leaderboards, friend challenges, daily routes, competitions, sharing failures, shop, inventory/equipment, real Telegram Stars payments, gift redemption, loot boxes, paid continues, gameplay boosters, passes, quests, multiple worlds, adaptive difficulty, multiplayer, or an AI director.

Those features should reuse simulation/events/configuration later. Do not build their UI, backend services, or abstractions preemptively. The selected larger service architecture remains a roadmap, not a reason to run the full distributed system for the first gameplay milestone.

The 18+ product direction remains recorded. Actual identity, age eligibility, production accounts, payment support, and launch-country review are separate release requirements for the eventual commercial service, not features proven by a local game build.

## 10. Acceptance gates

### First playable

- Start, tap, gravity, generated pipes, collision, score, death, and immediate restart work together.
- Currency definitions produce occasional safely placed pickups and correct run totals.
- Personal best persists; restart and storage failures do not corrupt a run.
- Pause/background/resume and resizing preserve rules and state.
- Works with touch and keyboard, without duplicate input or accumulating event listeners.

### Foundation v1.0.0 candidate

- Tests cover scoring exactly once, pickups exactly once, collision precedence, state transitions, repeat finalization, and PRNG reproducibility.
- Generation has automated transition/property checks, including pattern boundaries, and rejects invalid configurations. Document the tested feasibility bounds rather than claiming every conceivable configuration is safe.
- Seeded long-run tests show bounded active objects and input/state buffers.
- Different render schedules with identical simulation input ticks produce identical results; resizing and cosmetic changes cannot alter gameplay outcomes.
- TypeScript/Go golden-vector parity passes for the shared rule set before enabling verified competitive/account features.
- The owner playtests the build on selected desktop/mobile Telegram clients. Device performance targets are agreed and measured, not assumed.
- Report executed tests and remaining gaps honestly; no release tag is created merely because this specification exists.

## Implementation order

1. Pure flight, collision, and tick rules with tests.
2. Pattern generation and pipe scoring with tests.
3. Configurable collectible contract and both currency types with tests.
4. Minimal renderer, input, lifecycle, personal-best storage, and mobile layout.
5. Go parity fixtures and Telegram-client smoke testing.

Build one vertical slice at a time. Economy modeling and additional visual explorations no longer block this gameplay-first sequence.
