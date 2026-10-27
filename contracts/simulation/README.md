# Arcade simulation fixture contract

The arcade rules are documented in [`docs/ARCADE_SIMULATION.md`](../../docs/ARCADE_SIMULATION.md). The current varied-base default is simulation/generator `3.1.0`, configuration `dd-v3-varied-base-v1`, catalog 12; Core issues this identity for new runs. Catalog 11 (`3.0.0` / `3.0.0` / `dd-v3-base-bonus-v1`) and catalog 10 (`2.9.0` / `2.9.0` / `dd-v2-dense-pipes-v1`) remain separately resolvable for issued runs, along with earlier identities. The frozen `golden-v1.json` remains simulation `1.3.0`, generator `1.2.0`, configuration `dd-v1-stepped-v1`; its expected bytes are unchanged. `star-schedule-v1.json` adds authored seeded schedule vectors for the prior default. `currency-formations-v1.json` and `coin-course-v1.json` contain catalog-4 and catalog-5 expectations. `bonus-segments-v1.json` records catalog 6; `bonus-segments-v2.json` adds catalog-7 cases. `varied-pipes-v1.json` records catalog 8; `pressure-pipes-v1.json` records catalog 9 pressure-gap cases and `pressure-pipes-replay-v1.json` contains catalog-9 replay expectations; `dense-pipes-v1.json` and `dense-pipes-replay-v1.json` record catalog-10 cases; `base-bonus-v1.json` and `base-bonus-replay-v1.json` record catalog-11 cases; `varied-base-v1.json` and `varied-base-replay-v1.json` record catalog-12 gap and replay expectations.

## Authoritative files

- `packages/game-sim/src/index.ts`: stable API exporting the TypeScript simulation modules.
- `services/core/simulation`: independent Go implementation; `fixtures.go` owns raw-JSON fixture verification. See the [code map](../../docs/ARCHITECTURE.md) for both implementations' module ownership.
- `golden-v1.json`: reviewed complete initial states, expected operations/events, invalid cases, mixer vectors, and rule/config description.
- `star-schedule-v1.json`: authored first and next Star pipe targets consumed independently by the TypeScript and Go tests.
- `coin-course-v1.json`: authored raw state/event cases for catalog-5 coin courses; supplements frozen catalog-4 and earlier fixtures.
- `bonus-segments-v1.json`: authored raw state/event cases for catalog-6 bonus segments; supplements frozen catalog-4, catalog-5 and earlier fixtures.
- `bonus-segments-v2.json`: authored raw state/event cases for catalog-7 bonus segments v2; supplements the catalog-6, catalog-5 and earlier expectations.
- `wetland-v1.json`: wetland catalog and seeded family sequence, plus complete raw state/event cases for start, obstacle scoring, fatal-tick ordering, pickup collection and refill from a pruned horizon. Both implementations consume the same expectations.
- `wetland-config-validation.json`: frozen catalog-1 accepted/rejected configuration cases.
- `wetland-v2.json`: catalog-2 raw initial states and events for start, actual-width scoring with offscreen retention/refill, and fatal-tick pickup suppression.
- `wetland-v2-config-validation.json`: catalog-2 accepted/rejected configuration cases. Both languages consume the new files alongside the unchanged older fixtures.
- `wetland-v3.json`: paired catalog-3 raw state/event replay expectations consumed by both implementations.
- `wetland-v3-config-validation.json`: paired catalog-3 accepted/rejected configuration cases, alongside the frozen older corpora.
- `generate-fixtures.mjs`: explicit legacy reviewed-fixture producer; never run automatically from tests.
- `generate-wetland-paired-fixtures.mjs`: explicit paired-fixture producer; does not replace the older fixtures.

The legacy contract contains 13 complete-state cases, 40 operations, 29200 accumulated advance ticks, 5 invalid cases and 4 mixer vectors. The 24000-tick bounded witness uses a legacy gap-only custom configuration and preserves the prior 5800 speed cap and 225000 spacing; it does not make a default-world or universal custom-config reachability claim. A separate 5000-tick prior-default trace uses a controller that waits until a pipe center reaches x=360000 before targeting it, covers intro/cruise/pressure/recovery and exercises horizon refill. Independent TS and Go tests cover all 26 selectable family edges at prior-exit y offsets ±5000 and vertical velocities ±500 after an 18-tick hold. This is bounded controller-specific physics evidence, not universal or human latest-action proof; playtest acceptance remains open. Legacy fixture outputs are verified by Vitest and the independent Go implementation. Prior Star schedule vectors are authored separately and tested by both implementations. Critical formulas, bounds, and behavior are also asserted separately in tests.

Run `npm run build:sim && node contracts/simulation/generate-fixtures.mjs` only after inspecting a deliberate simulation change. Run `npm run test:parity` to verify committed expectations with both implementations.

See [wetland challenges](../../docs/WETLAND_CHALLENGES.md) for the new encounter contract and current verification status. New wetland fixtures supplement the existing frozen fixtures; they do not replace or regenerate them.

The deferred catalog-2 controller matrix and local counterfactual are experimental
checks enabled with `RUN_MIXED_OBSTACLE_EXPERIMENTS=1`; they are not paired-route
acceptance evidence. See the wetland record for the retained failing case.
