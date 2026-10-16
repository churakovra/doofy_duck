# Arcade simulation fixture contract

The arcade rules are documented in [`docs/ARCADE_SIMULATION.md`](../../docs/ARCADE_SIMULATION.md). Current ruleset identity: simulation `1.3.0`, gap generator `1.2.0`, default configuration `dd-v1-stepped-v1`, fixture revision `stepped-challenges-1`.

## Authoritative files

- `packages/game-sim/src/index.ts`: stable API exporting the TypeScript simulation modules.
- `services/core/simulation`: independent Go implementation; `fixtures.go` owns raw-JSON fixture verification. See the [code map](../../docs/ARCHITECTURE.md) for both implementations' module ownership.
- `golden-v1.json`: reviewed complete initial states, expected operations/events, invalid cases, mixer vectors, and rule/config description.
- `generate-fixtures.mjs`: explicit reviewed-fixture producer; never run automatically from tests.

The contract contains 13 complete-state cases, 40 operations, 29200 accumulated advance ticks, 5 invalid cases and 4 mixer vectors. The 24000-tick bounded witness uses a legacy gap-only custom configuration and preserves the prior 5800 speed cap and 225000 spacing; it does not make a default-world or universal custom-config reachability claim. A separate 5000-tick default trace uses a controller that waits until a pipe center reaches x=360000 before targeting it, covers intro/cruise/pressure/recovery and exercises horizon refill. Independent TS and Go tests cover all 26 selectable family edges at prior-exit y offsets ±5000 and vertical velocities ±500 after an 18-tick hold. This is bounded controller-specific physics evidence, not universal or human latest-action proof; playtest acceptance remains open. Fixture outputs are TypeScript-produced and verified by Vitest and the independent Go implementation. Critical formulas, bounds, and behavior are also asserted separately in tests.

Run `npm run build:sim && node contracts/simulation/generate-fixtures.mjs` only after inspecting a deliberate simulation change. Run `npm run test:parity` to verify committed expectations with both implementations.
