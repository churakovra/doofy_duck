# Code map

This is a local browser game and two implementations of the same deterministic
simulation. There is no running Go HTTP service, account system, or distributed
backend in this repository. The root [README](../README.md) owns setup commands;
the [documentation map](README.md) distinguishes current rules from old reports.

## Runtime flow

```text
apps/web/index.html → src/main.tsx → Game.tsx
                                     ├─ useGameRun → clock + input → game-sim
                                     ├─ useGameProgress → wallet + session + storage
                                     ├─ useGameAudio → audio
                                     └─ GameCanvas → Pixi + feel

TypeScript simulation ← shared fixtures/schema → native Go simulation
```

The browser runs the TypeScript simulation. The Go library independently replays
the contract; the browser does not call it. React presents HUD/lifecycle changes,
while Pixi reads simulation state and draws cosmetic feedback.

## Source ownership

| Path | Responsibility |
| --- | --- |
| [apps/web/src/main.tsx](../apps/web/src/main.tsx) | React mount and error boundary |
| [Game.tsx](../apps/web/src/Game.tsx) | UI composition and controls |
| [useGameRun.ts](../apps/web/src/useGameRun.ts) | Run descriptors, lifecycle, queued input, fixed-step advancement |
| [clock.ts](../apps/web/src/clock.ts), [input.ts](../apps/web/src/input.ts) | Tick scheduling and accepted pointer/keyboard actions |
| [GameCanvas.tsx](../apps/web/src/GameCanvas.tsx), [feel.ts](../apps/web/src/feel.ts) | Pixi lifecycle, state presentation, cosmetic effects |
| [useGameProgress.ts](../apps/web/src/useGameProgress.ts) | Best score and completed-run settlement coordination |
| [wallet.ts](../apps/web/src/wallet.ts), [wallet-session.ts](../apps/web/src/wallet-session.ts), [storage.ts](../apps/web/src/storage.ts) | Local record validation, deduplication, tab ownership, persistence fallback |
| [useGameAudio.ts](../apps/web/src/useGameAudio.ts), [audio.ts](../apps/web/src/audio.ts) | Audio lifecycle, preferences, synthesized sounds/music |
| [style.css](../apps/web/src/style.css) | Viewport scaling and interface layout |
| [packages/game-sim/src/index.ts](../packages/game-sim/src/index.ts) | Pure TypeScript rules, public types, config identity, state, ordered events |
| [services/core/simulation/simulation.go](../services/core/simulation/simulation.go) | Native Go rules, canonical serialization, raw fixture verification |
| [contracts/simulation](../contracts/simulation/README.md) | Reviewed full-state/event fixtures, descriptor schema, explicit producer |

## Change routing

| Task | Start here | Related checks from root |
| --- | --- | --- |
| Controls, pause/resume, startup/restart | `useGameRun`, `clock`, `input` | Relevant Vitest tests; production browser; development browser for StrictMode |
| Appearance or viewport | `GameCanvas`, `feel`, `style.css` | Relevant unit/browser cases; visually inspect affected states |
| Local balances or best | `useGameProgress`, `wallet`, `wallet-session`, `storage` | Wallet/session unit and browser cases |
| Sound/music | `audio`, `useGameAudio` | Audio unit and browser cases; physical playback is separate evidence |
| Physics, gaps, speed, scoring, pickups | TS simulation and Go simulation together | Semantic tests in both languages and `npm run test:parity` |
| Descriptor/config/state/event shape | Both simulations, descriptor schema, fixtures and browser consumers | Schema/fixture tests and parity; review identity compatibility |
| Documentation | Relevant current document and documentation map | Local links and diff review |

## Check locations and build boundaries

- Root `package.json` defines the operational commands. There is one npm
  workspace/lockfile for `apps/web` and `packages/game-sim`.
- The simulation package exports `dist/index.js`. Root dev/typecheck/browser
  commands build it first; edit `src/index.ts`, not generated `dist`.
- Vitest discovers unit tests in both the web and simulation trees. Playwright
  tests in `apps/web/test` are excluded from Vitest.
- Production browser checks use port 4174; development checks use 4175. Manual
  play uses 4173. Browser suites intentionally refuse server reuse.
- The Go module is isolated in `services/core/simulation` and uses the standard
  library. Its tests read the same committed fixtures as TypeScript.
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) defines CI checks.
  A workflow file alone is not evidence of a hosted CI run.

Keep these paths stable unless a task requires moving them: workspace exports,
test fixture paths, Playwright configs, and documentation links depend on them.
