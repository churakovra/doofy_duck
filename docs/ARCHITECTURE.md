# Code map

This is a local browser game and two implementations of the same deterministic
simulation. There is no running Go HTTP service, account system, or distributed
backend in this repository. The root [README](../README.md) owns setup commands;
the [documentation map](README.md) separates current behavior, product goals, and future architecture.

## Runtime flow

```text
apps/web/index.html → src/main.tsx → Game.tsx
                                     ├─ useGameRun → clock + input → game-sim
                                     ├─ useGameProgress → local-progress → wallet + locks + storage
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
| [useGameProgress.ts](../apps/web/src/useGameProgress.ts), [local-progress.ts](../apps/web/src/local-progress.ts) | Thin React subscription adapter and pure injected local progress session |
| [wallet.ts](../apps/web/src/wallet.ts), [wallet-session.ts](../apps/web/src/wallet-session.ts), [storage.ts](../apps/web/src/storage.ts) | Local record validation, deduplication, tab ownership, persistence fallback |
| [useGameAudio.ts](../apps/web/src/useGameAudio.ts), [audio.ts](../apps/web/src/audio.ts) | Audio lifecycle, preferences, synthesized sounds/music |
| [messages.ru.ts](../apps/web/src/messages.ru.ts) | Typed Russian presentation catalog; English translation/selection remain future work |
| [style.css](../apps/web/src/style.css) | Viewport scaling and interface layout |
| [packages/game-sim/src/index.ts](../packages/game-sim/src/index.ts) | Pure TypeScript rules, public types, config identity, state, ordered events |
| [services/core/simulation/simulation.go](../services/core/simulation/simulation.go) | Native Go rules, canonical serialization, raw fixture verification |
| [contracts/simulation](../contracts/simulation/README.md) | Reviewed full-state/event fixtures, descriptor schema, explicit producer |

## Change routing

| Task | Start here | Related checks from root |
| --- | --- | --- |
| Controls, pause/resume, startup/restart | `useGameRun`, `clock`, `input` | Relevant Vitest tests; browser/StrictMode suites only on request |
| Appearance or viewport | `GameCanvas`, `feel`, `style.css` | Relevant unit cases; browser/visual checks only on request |
| Local balances or best | `local-progress`, `useGameProgress`, `wallet`, `wallet-session`, `storage` | Wallet/session unit cases; browser cases only on request |
| Sound/music | `audio`, `useGameAudio` | Audio unit cases; browser cases only on request; physical playback is separate evidence |
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
- Browser suites use one worker to isolate SwiftShader CPU load from game timing.
- Production browser checks use port 4174; development checks use 4175. Manual
  play uses 4173. Browser suites intentionally refuse server reuse.
- The Go module is isolated in `services/core/simulation` and uses the standard
  library. Its tests read the same committed fixtures as TypeScript.
- `npm run check` runs routine types, lint, unit/fixture tests, Go tests, and build.
  Browser suites are opt-in through `npm run check:browser` or `npm run check:full`.
  Routine fixes do not automatically launch browser tests.
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) defines routine CI checks and an optional manual browser run.
  A workflow file alone is not evidence of a hosted CI run.

Keep these paths stable unless a task requires moving them: workspace exports,
test fixture paths, Playwright configs, and documentation links depend on them.

## Runtime limits and performance evidence

The scheduler executes at most five 60 Hz ticks per frame. A frame gap or
accumulated backlog above 250 ms clears timing debt and requests a pause before
executing that frame's ticks. The clock stays latched until explicit resume;
idle/paused/dead presentation does not accumulate simulation debt. Interpolation
is bounded to 0–1. Inputs queued before an overload pause are discarded.

Local progress is browser-owned and untrusted. The pure session accepts storage
and lock dependencies; it has no server-wallet implementation. Its frozen
snapshots cannot transfer authority to client balances. Paid continue transitions
and their accounting remain feature work.

[Go benchmarks](SIMULATION_BENCHMARKS.md) establish a deterministic native
simulation baseline, not HTTP/database throughput or production player capacity.
