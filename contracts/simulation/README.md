# Arcade simulation fixture contract

The arcade rules are documented in [`docs/ARCADE_SIMULATION.md`](../../docs/ARCADE_SIMULATION.md). Current ruleset identity: simulation `1.2.0`, gap generator `1.1.0`, default configuration `dd-v1-arcade-v2`, fixture revision `foundation-arcade-2`.

## Authoritative files

- `packages/game-sim/src/index.ts`: TypeScript simulation implementation and API.
- `services/core/simulation/simulation.go`: independent Go implementation and raw-JSON fixture verifier.
- `golden-v1.json`: reviewed complete initial states, expected operations/events, invalid cases, mixer vectors, and rule/config description.
- `generate-fixtures.mjs`: explicit reviewed-fixture producer; never run automatically from tests.

The contract currently contains 12 complete-state cases, 30 operations, 24200 accumulated advance ticks, 5 invalid cases and 4 mixer vectors. The 24000-tick bounded witness uses an intentionally permissive custom configuration; it does not make a default-world or universal custom-config reachability claim. Fixture outputs are TypeScript-produced and verified by Vitest and the independent Go implementation. Critical formulas, bounds, and behavior are also asserted separately in tests.

Run `npm run build:sim && node contracts/simulation/generate-fixtures.mjs` only after inspecting a deliberate simulation change. Run `npm run test:parity` to verify committed expectations with both implementations.
