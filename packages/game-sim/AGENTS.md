# TypeScript simulation

The public export surface is `src/index.ts`; rules live in `src/simulation.ts`,
generation in `src/generation.ts`, and configuration in `src/config.ts`.
Package exports point to generated `dist/index.js`. Read [current rules](../../docs/ARCADE_SIMULATION.md) and the
[fixture contract](../../contracts/simulation/README.md) for behavioral changes.

- Keep the simulation pure: no React, Pixi, browser, storage, wall clock, network,
  or ambient randomness. Use the specified integer arithmetic and RNG behavior.
- Preserve immutable returned state, complete config validation, safe counter
  bounds, ordered events, and lifecycle semantics.
- Mirror semantic changes in `services/core/simulation/simulation.go`. Review
  version/config identities, descriptor schema, and all state/event consumers.
- Legacy catalog exports are compatibility data; current random gap generation
  is described in the current rules document.
- Review fixture changes deliberately; never update expectations to hide a bug.

From the repository root, `npx vitest run packages/game-sim/test` checks semantic
and fixture cases. `npm run test:parity` builds the simulation and runs TS fixture
checks plus native Go tests. Use `npm run typecheck` and `npm run lint` for TS
changes. A bounded custom-configuration witness is not a proof that every default
or custom world is survivable.
