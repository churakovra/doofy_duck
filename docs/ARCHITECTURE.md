# Code map

The repository contains one account-backed game with a TypeScript/Python/PostgreSQL
stack. Local development connects a development Telegram identity; production
requires Telegram authentication. Verified pickup settlement and the cosmetic shop
are enabled by normal local startup unless explicitly disabled. Production economy
activation remains separate. Paid continue, XTR payments and hosted deployment
remain outside the delivered code.

## Runtime flow

```text
apps/web/index.html → src/main.tsx → Game → AccountGame
                                           ├─ account/session bootstrap
                                           ├─ AccountFlight → useGameRun → game-sim
                                           ├─ account trace/checkpoint recovery
                                           ├─ AccountShop → wallet/inventory/equipment
                                           ├─ useGameAudio → audio
                                           └─ GameCanvas → scene + appearance + feel → Pixi

Browser → one-origin gateway → Python Platform: identity/session/account/economy
                            → TypeScript Core: issued run → replay → PostgreSQL checkpoints
                                                     └→ durable outbox → Python inbox
                                                                        └→ settlement worker → wallet ledger
```

The browser and Core run the same TypeScript simulation; Core independently replays submitted inputs.
AccountGame automatically authenticates the launch identity and provides no
account-selection or logout UI. The API client pins refreshes to the verified
account. AccountGame coordinates memory-only access credentials, per-tick input recording,
IndexedDB recovery, checkpoint submission and reconciliation. There is no public
practice path or browser-wallet fallback. Legacy local progress utilities remain
isolated from account authority and their balances are never imported.

Python owns separate Platform/Economy modules and databases; Core owns its database.
There are no cross-service SQL reads. Completion receipts durably store verified
facts; settlement credits the Economy ledger under a pinned policy. Shop debit,
entitlement and purchase result share one transaction. See the versioned
[account](../contracts/http/account-auth-v1.md)/[run](../contracts/http/core-run-v1.md) contracts.

## Source ownership

| Path | Responsibility |
| --- | --- |
| [apps/web/src/main.tsx](../apps/web/src/main.tsx) | React mount and error boundary |
| `apps/web/src/AccountGame.tsx`, `account-api.ts`, `account-trace.ts`, `checkpoint-backoff.ts`, `account-logout.ts` | Account lifecycle, bounded authenticated requests, shared checkpoint retry deadlines, ordered logout cleanup, exact input transport and validated IndexedDB recovery |
| `services/platform/app`, `services/platform/migrations` | Telegram auth, signed tokens, rotating refresh sessions, account lookup and idempotent completion inbox |
| `services/platform/app/economy` | Wallet ledger, gated completion settlement, catalog, inventory, revisioned equipment, atomic purchases and operator worker/audit commands |
| `services/core/typescript` | TypeScript Core HTTP authorization, replay, run ownership, checkpoints, migrations and outbox |
| `deploy` | Compose, gateway routing, isolated development credentials and cross-service smoke |
| [Game.tsx](../apps/web/src/Game.tsx), [GameButton.tsx](../apps/web/src/GameButton.tsx), [GameSettings.tsx](../apps/web/src/GameSettings.tsx) | Single account entry point, shared button variants/input isolation, and the settings menu |
| [useGameRun.ts](../apps/web/src/useGameRun.ts) | Run descriptors, lifecycle, queued input, fixed-step advancement |
| [clock.ts](../apps/web/src/clock.ts), [input.ts](../apps/web/src/input.ts) | Tick scheduling and accepted pointer/keyboard actions |
| [GameCanvas.tsx](../apps/web/src/GameCanvas.tsx) | Serialized Pixi lifecycle and frame presentation |
| [scene.ts](../apps/web/src/scene.ts), [appearance.ts](../apps/web/src/appearance.ts), [feel.ts](../apps/web/src/feel.ts) | Scene drawing, physics-neutral palettes, bounded cosmetic effects |
| [GameWardrobe.tsx](../apps/web/src/GameWardrobe.tsx), [GameWardrobePreview.tsx](../apps/web/src/GameWardrobePreview.tsx), [wardrobe.ts](../apps/web/src/wardrobe.ts) | Legacy local wardrobe helpers, static preview and shared cosmetic catalog definitions |
| [wardrobe-assets.ts](../apps/web/src/wardrobe-assets.ts), [wardrobe-image-layer.ts](../apps/web/src/wardrobe-image-layer.ts) | Asynchronous cosmetic texture loading and shared preview/gameplay image placement with procedural fallback |
| [useGameProgress.ts](../apps/web/src/useGameProgress.ts), [local-progress.ts](../apps/web/src/local-progress.ts) | Legacy browser-progress adapter and pure local progress session |
| [wallet.ts](../apps/web/src/wallet.ts), [wallet-session.ts](../apps/web/src/wallet-session.ts), [storage.ts](../apps/web/src/storage.ts) | Legacy browser-wallet validation, deduplication, tab ownership and persistence fallback |
| [useGameAudio.ts](../apps/web/src/useGameAudio.ts), [audio.ts](../apps/web/src/audio.ts) | Audio lifecycle, preferences, synthesized sounds/music |
| [locale.tsx](../apps/web/src/locale.tsx), [messages.ru.ts](../apps/web/src/messages.ru.ts), [messages.en.ts](../apps/web/src/messages.en.ts) | Saved locale preference, typed bilingual catalogs, count formatting, and document language |
| [style.css](../apps/web/src/style.css) | Viewport scaling and interface layout |
| [packages/game-sim/src/index.ts](../packages/game-sim/src/index.ts) | Stable public simulation exports |
| [types.ts](../packages/game-sim/src/types.ts), [config.ts](../packages/game-sim/src/config.ts), [canonical.ts](../packages/game-sim/src/canonical.ts) | Shared types, rule defaults/validation, canonical configuration identity |
| [simulation.ts](../packages/game-sim/src/simulation.ts), [generation.ts](../packages/game-sim/src/generation.ts) | Run lifecycle, ordered tick rules, seeded world generation |
| [collectibles.ts](../packages/game-sim/src/collectibles.ts) | Public compatibility collectible helpers |
| [contracts/simulation](../contracts/simulation/README.md) | Reviewed full-state/event fixtures, descriptor schema, explicit producer |

## Change routing

| Task | Start here | Related checks from root |
| --- | --- | --- |
| Controls, pause/resume, startup/restart | `useGameRun`, `clock`, `input` | Relevant Vitest tests; browser/StrictMode suites only on request |
| Appearance or viewport | `scene`, `appearance`, `GameCanvas`, `feel`, `style.css` | Relevant unit cases; browser/visual checks only on request |
| Account balances or best | `AccountWallet`, Economy settlement and ledger, Core account progress | Relevant service and client tests; integration checks when required |
| Sound/music | `audio`, `useGameAudio` | Audio unit cases; browser cases only on request; physical playback is separate evidence |
| Physics, gaps, speed, scoring, pickups | TypeScript simulation | Semantic and fixture tests |
| Descriptor/config/state/event shape | Simulation, descriptor schema, fixtures and browser consumers | Schema/fixture tests; review identity compatibility |
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
- `npm run check` runs routine types, lint, unit/fixture tests, and build.
  Browser suites are opt-in through `npm run check:browser` or `npm run check:full`.
  Routine fixes do not automatically launch browser tests.

Keep these paths stable unless a task requires moving them: workspace exports,
test fixture paths, Playwright configs, and documentation links depend on them.

## Runtime limits and performance evidence

The scheduler executes at most five 60 Hz ticks per frame. A frame gap or
accumulated backlog above 250 ms clears timing debt and requests a pause before
executing that frame's ticks. The clock stays latched until explicit resume;
idle/paused/dead presentation does not accumulate simulation debt. Interpolation
is bounded to 0–1. Inputs queued before an overload pause are discarded.

Legacy browser progress is untrusted and unreachable through the game entry point.
Account progress uses verified completion evidence and never imports browser
balances. Frozen client snapshots cannot transfer authority to client balances.
Paid continue transitions and their accounting remain feature work.

Simulation benchmarks do not measure HTTP/database throughput or production player capacity.
