# Code map

The repository contains a standalone local practice game and an optional account-backed
Python/Go/PostgreSQL stack. Account currency issuance, purchases, paid continue and
hosted deployment remain outside the delivered foundation. The root [README](../README.md)
owns commands; [backend evidence](BACKEND_FOUNDATION.md) distinguishes executed checks
from hosted and real Telegram acceptance.

## Runtime flow

```text
apps/web/index.html → src/main.tsx → Game.tsx
                                     ├─ useGameRun → clock + input → game-sim
                                     ├─ useGameProgress → local-progress → wallet + locks + storage
                                     ├─ useGameAudio → audio
                                     └─ GameCanvas → scene + appearance + feel → Pixi

TypeScript simulation ← shared fixtures/schema → native Go simulation
```

The browser runs the TypeScript simulation. The Go library independently replays
the contract; the browser does not call it. React presents HUD/lifecycle changes,
while Pixi reads simulation state and draws cosmetic feedback.

Account mode uses the same simulation and renderer, with `AccountGame` coordinating
memory-only access credentials, exact per-tick input recording, IndexedDB recovery,
checkpoint submission and status reconciliation. It never settles the practice wallet.

```text
Browser → one-origin gateway → Python Platform: identity/session/account
                            → Go Core: issued run → replay → PostgreSQL checkpoints
                                                     └→ durable outbox → Python inbox
```

Python owns separate Platform/Economy modules and databases; Core owns its database.
There are no cross-service SQL reads. Completion receipts store verified facts without
issuing currency. See [approved ownership](ADR-001-MICROSERVICES.md) and the versioned
[account](../contracts/http/account-auth-v1.md)/[run](../contracts/http/core-run-v1.md) contracts.

## Source ownership

| Path | Responsibility |
| --- | --- |
| [apps/web/src/main.tsx](../apps/web/src/main.tsx) | React mount and error boundary |
| `apps/web/src/AccountGame.tsx`, `account-api.ts`, `account-trace.ts` | Account-mode lifecycle, in-memory access credentials, exact input transport and validated IndexedDB recovery |
| `services/platform/app`, `services/platform/migrations` | Telegram auth, signed tokens, rotating refresh sessions, account lookup and idempotent completion inbox |
| `services/core/backend` | Go HTTP authorization, run ownership, replay/checkpoints, writer fencing, outage windows, outbox and load harness |
| `deploy` | Compose, gateway routing, isolated development credentials and cross-service smoke |
| [Game.tsx](../apps/web/src/Game.tsx), [GameButton.tsx](../apps/web/src/GameButton.tsx), [GameSettings.tsx](../apps/web/src/GameSettings.tsx) | UI composition, shared button variants/input isolation, and the always-available settings menu |
| [useGameRun.ts](../apps/web/src/useGameRun.ts) | Run descriptors, lifecycle, queued input, fixed-step advancement |
| [clock.ts](../apps/web/src/clock.ts), [input.ts](../apps/web/src/input.ts) | Tick scheduling and accepted pointer/keyboard actions |
| [GameCanvas.tsx](../apps/web/src/GameCanvas.tsx) | Serialized Pixi lifecycle and frame presentation |
| [scene.ts](../apps/web/src/scene.ts), [appearance.ts](../apps/web/src/appearance.ts), [feel.ts](../apps/web/src/feel.ts) | Scene drawing, physics-neutral palettes, bounded cosmetic effects |
| [GameWardrobe.tsx](../apps/web/src/GameWardrobe.tsx), [GameWardrobePreview.tsx](../apps/web/src/GameWardrobePreview.tsx), [wardrobe.ts](../apps/web/src/wardrobe.ts) | Local draft/apply wardrobe, static preview, stable cosmetic catalogs and equipment preferences |
| [wardrobe-assets.ts](../apps/web/src/wardrobe-assets.ts), [wardrobe-image-layer.ts](../apps/web/src/wardrobe-image-layer.ts) | Asynchronous cosmetic texture loading and shared preview/gameplay image placement with procedural fallback |
| [useGameProgress.ts](../apps/web/src/useGameProgress.ts), [local-progress.ts](../apps/web/src/local-progress.ts) | Thin React subscription adapter and pure injected local progress session |
| [wallet.ts](../apps/web/src/wallet.ts), [wallet-session.ts](../apps/web/src/wallet-session.ts), [storage.ts](../apps/web/src/storage.ts) | Local record validation, deduplication, tab ownership, persistence fallback |
| [useGameAudio.ts](../apps/web/src/useGameAudio.ts), [audio.ts](../apps/web/src/audio.ts) | Audio lifecycle, preferences, synthesized sounds/music |
| [locale.tsx](../apps/web/src/locale.tsx), [messages.ru.ts](../apps/web/src/messages.ru.ts), [messages.en.ts](../apps/web/src/messages.en.ts) | Saved locale preference, typed bilingual catalogs, count formatting, and document language |
| [style.css](../apps/web/src/style.css) | Viewport scaling and interface layout |
| [packages/game-sim/src/index.ts](../packages/game-sim/src/index.ts) | Stable public simulation exports |
| [types.ts](../packages/game-sim/src/types.ts), [config.ts](../packages/game-sim/src/config.ts), [canonical.ts](../packages/game-sim/src/canonical.ts) | Shared types, rule defaults/validation, canonical configuration identity |
| [simulation.ts](../packages/game-sim/src/simulation.ts), [generation.ts](../packages/game-sim/src/generation.ts) | Run lifecycle, ordered tick rules, seeded world generation |
| [collectibles.ts](../packages/game-sim/src/collectibles.ts) | Public compatibility collectible helpers |
| [services/core/simulation/simulation.go](../services/core/simulation/simulation.go) | Native state types, tick rules, and lifecycle |
| [config.go](../services/core/simulation/config.go), [canonical.go](../services/core/simulation/canonical.go), [generation.go](../services/core/simulation/generation.go) | Native configuration, identity encoding, and generation |
| [fixtures.go](../services/core/simulation/fixtures.go) | Offline raw-JSON contract verifier |
| [contracts/simulation](../contracts/simulation/README.md) | Reviewed full-state/event fixtures, descriptor schema, explicit producer |

## Change routing

| Task | Start here | Related checks from root |
| --- | --- | --- |
| Controls, pause/resume, startup/restart | `useGameRun`, `clock`, `input` | Relevant Vitest tests; browser/StrictMode suites only on request |
| Appearance or viewport | `scene`, `appearance`, `GameCanvas`, `feel`, `style.css` | Relevant unit cases; browser/visual checks only on request |
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
- Vitest aliases the simulation package to source; unit tests do not depend on
  a pre-existing or current `dist` directory. Production builds retain the package export.
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

Practice progress is browser-owned and untrusted. The pure practice session accepts storage
and lock dependencies; it has no server-wallet implementation. Account mode stores verified
completion evidence separately and never imports practice balances. Its frozen
snapshots cannot transfer authority to client balances. Paid continue transitions
and their accounting remain feature work.

[Go benchmarks](SIMULATION_BENCHMARKS.md) establish a deterministic native
simulation baseline, not HTTP/database throughput or production player capacity.
