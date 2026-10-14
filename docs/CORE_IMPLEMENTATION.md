# Core simulation implementation handoff

**Current parent update:** see `PARENT_CORE_VERIFICATION.md` and `../contracts/simulation/README.md` for stabilized foundation-2 rules and executed checks. Historical partial handoff notes below are retained, but no longer describe the current fixture, map selection, safe lead-in, configuration identity, or resolved spawning/counter defects. Independent review and Go parity are still separate gates.

Status: standalone deterministic TypeScript core, **incomplete foundation; not V1-ready**. This update adds one-shot pipe-index collectible opportunities, an explicit finite gap-pattern catalog, spacing configuration, formatted source, and stricter geometry checks. It does not establish default-config reachability, a complete supported-config identity registry, full canonical trace parity, or Go parity. Do not treat this contract as frozen for a Go verifier.

## Files

- `packages/game-sim/src/index.ts` — simulation types, configuration validation, deterministic run/step/lifecycle, generated pipes, collectible definitions and event contracts.
- `packages/game-sim/test/core.test.ts` — behavior and bounded-run regression tests.
- `packages/game-sim/package.json`, `packages/game-sim/tsconfig.build.json` — workspace package and build.
- Root `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js` — exact pinned workspace tooling.
- `contracts/simulation/run-descriptor.schema.json` — language-neutral run descriptor schema.
- `contracts/simulation/golden-v1.json` — numeric/RNG rules, initial state, four tick input/output snapshots, ordered events, and representative invalid cases. Snapshots are currently a limited sample, not the full canonical state/event corpus required for Go parity.

## Public API

Import `@doofy-duck/game-sim` (package export points at `dist/index.js`; run `npm run build` first). Main exports:

- `DEFAULT_CONFIG`, `validateConfig(config)`, `validateDescriptor(descriptor)`
- `RunDescriptor`, `GameConfig`, `RunState`, `InputFrame`, `GameEvent`, `StepResult`, entity and definition types
- `createRun(descriptor, config?)`, `step(state, frames)`, `pauseRun(state)`, `resumeRun(state)`, `restartRun(state, newDescriptor, config?)`
- `makeInput(sequence, 'FLAP')`, `generateNext(state)`, `canonicalState(state)`, `mix32(uint32)`
- Abstract `CollectibleType`; concrete `Feather` and `GameStar`; `collectibleFromDefinition(definition)`

`RunState` holds descriptor/config, phase, tick, duck, live pipes/collectibles, score/totals, PRNG cursor, sequence cursors, `nextSpawnPipeIndex`, and finalization count. `nextSpawnPipeIndex` records the next pipe index whose collectible opportunity has not been considered. All state returned by public mutators is recursively frozen. `step` is a pure transition and returns ordered events alongside the next state. `PAUSED`/`DEAD` transitions return the same state without simulation. `resumeRun` only changes the phase; its caller must supply a fresh input. Restart requires a different run ID. InputFrame sequence is contiguous across calls; the call to `step` supplies the tick implicitly, and multiple FLAP frames in one call apply at most one flap.

## Numeric and deterministic rules

- Coordinates, speeds, and velocities are integer milli-pixels; simulation rate is 60 ticks/s (no wall-clock use). Config values are not converted from pixels.
- Each running tick: validate contiguous input sequence; if any FLAP exists, set `vy = flapVelocity` once; add gravity and clamp only the falling side to `maxFallSpeed`; integrate `y`; move world left; resolve lethal boundaries/AABBs; on survival score passed pipes then award pickups; cleanup and generate to horizon.
- First READY FLAP starts and flaps on that tick. Inputs in one call are sequence-validated; an array with >1 FLAP still sets one velocity for the tick.
- Edge-touch is lethal. Duck and pipe are AABBs; pipe/gap clearance includes duck half-height. Vertical step is bounded by configured velocity, and pipe width is greater than default pipe speed, preventing pipe tunneling for defaults. Boundary sweeps are not separately implemented.
- `PATTERN_CATALOG` is a finite three-entry authored catalog (`center`, `rise-fall`, `fall-rise`), each four gaps long; pattern blocks repeat in catalog order. Configured `pipes.spacing` is 220000 by default. IDs are monotonic `pipe-{index}`. This is an explicit data catalog, not a universal authoring/feasibility engine. The present catalog is not seeded-selected; the seed still advances the specified PRNG cursor for each generated pipe, but pattern choice is deterministic by index.
- Collectible opportunities at newly generated pipe indices are consumed at most once, recorded by `nextSpawnPipeIndex`; opportunities below index 2 are ineligible. Eligible weighted draws include NONE and advance the RNG state once. Capacity and spacing can suppress a selected item; they do not cause retries. Spawned objects use the pipe's post-movement coordinates and are not moved an extra tick. The v1 default weights remain NONE 78 / Feather 18 / GameStar 4.
- Coordinates are window-relative: the simulation keeps only nearby pipes and uses stable integer pipe indices/IDs. No coordinate rebasing is implemented or needed for currently generated local x positions; lifetime tick/score numeric bounds still need enforcement before claiming unbounded operation.

Default flight: gravity 80, flap -4200, max fall 6000; duck center x 160000, AABB half extents 12000 x 10000. Default world: 0..580000 vertical, pipe speed 2400, width 52000, gap 176000. Config validation rejects noninteger/out-of-bounds physics values, invalid dimensions/weights/definitions, and invalid descriptors. It does **not** prove reachability for arbitrary user-supplied configurations.

## TDD and verification evidence

- RED/GREEN evidence: the first new spawn regression failed because `RunState` had no once-only opportunity cursor; after adding the cursor, one-time opportunity consumption, and per-opportunity PRNG advancement, the focused core suite passes. A geometry test failed because negative duck half-height was accepted; positive extents and pattern-gap bounds were then validated.
- Latest executed evidence: `npm test` — 2 files / 21 tests passed before the final assertion tightening; focused `npm test -- packages/game-sim/test/core.test.ts` — 1 file / 17 tests passed after it. `npm run typecheck`, `npm run lint`, `npm run build`, and browser tests (3 passed) succeeded. Browser tests were run before the last test-only assertion edit.
- This does **not** meet full acceptance: tests do not establish a default-physics long-run surviving controller, catalog transition reachability witnesses, a complete config identity allowlist, safe lifetime tick/score limits, or the requested canonical multi-case trace set. `golden-v1.json` still reflects the former random gap generator and is stale against the current pattern catalog/spawn cursor; consumers must not implement Go parity from it yet.
- Local coordinates remain window-relative; pipes are bounded to the active horizon and use stable integer indices/IDs. No rebasing is present. No zero-leak or real-device claim is made.

## Coverage and gaps

- **V1-01/TR-06/TR-11 (partial):** pinned runnable workspace, strict types, descriptor validator/schema, build/test/lint scripts, deterministic contract fixture. No CI or clean alternate machine execution.
- **V1-02/TR-01/TR-02/TR-04 (partial):** flight, first-tap semantics, fixed step, lifecycle pause/resume/restart, terminal death, edge collision, sequence checking. No rendered input edge/debounce integration. Personal-best storage excluded.
- **TR-03/TR-04/TR-05/TR-09 blockers:** generated geometry still uses hardcoded gap centers and spacing rather than a true authored pattern catalog; no supported-transition reachability solver exists. Spawn opportunities are not tracked independently, so NONE can be re-evaluated; spawn RNG cursor advancement is not implemented. New collectibles are moved an extra tick relative to their pipe. The current bounds do not prove default-tuning long-run survival, and there is no coordinate rebasing or lifetime numeric-bound test. Configuration identity is not yet a canonical registry/fingerprint, and custom tuning can still be represented with the default ID. Do not claim the generator safe or configuration replay-compatible beyond tested defaults.
- **TR-10:** the TypeScript fixture now includes a four-tick trace, but snapshots are partial and there is no Go implementation/parity run. Canonical cross-language encoding and broad invalid-case coverage remain open.
- No personal best, renderer, browser lifecycle, storage, swept collision, camera/resize, device tests, Go parity, or production/reward claims. Do not mark V1 or mobile/native acceptance complete.

Next consumer steps: validate the schema/fixture independently in Go; implement equivalent numeric/RNG and ordered events against the supplied contract; coordinate any contract change before consumers pin this API.
