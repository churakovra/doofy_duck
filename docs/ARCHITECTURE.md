# Code map

The repository contains one account-backed game with a TypeScript/Python/PostgreSQL
stack. Local development connects a development Telegram identity; production
requires Telegram authentication. Verified pickup settlement and the cosmetic shop
are enabled by normal local startup unless explicitly disabled. Production economy
activation remains separate. Paid continue, XTR payments and hosted deployment
remain outside the delivered code.

## Runtime flow

```text
apps/web/index.html → src/main.tsx → AccountGame
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
practice path or browser-wallet fallback. Browser balances are never imported.
Starting a new run carries the player's Start action through issuance and
renderer initialization. A recovered run or a page hidden during startup
requires a fresh action before flight.

Python owns separate Platform/Economy modules and databases; Core owns its database.
There are no cross-service SQL reads. Completion receipts durably store verified
facts; settlement credits the Economy ledger under a pinned policy. Shop debit,
entitlement and purchase result share one transaction. The ledger is immutable,
and the `wallet-audit` operator command compares it with stored balances.
Pending rewards become spendable after settlement. Coins (`FEATHER`) and in-game Stars (`GAME_STAR`)
are internal balances. The [account](../contracts/http/account-auth-v1.md),
[run](../contracts/http/core-run-v1.md), and
[wallet](../contracts/http/economy-wallet-v1.md) contracts define the APIs.

## Source ownership

| Path | Responsibility |
| --- | --- |
| [apps/web/src/main.tsx](../apps/web/src/main.tsx) | React mount and error boundary |
| `apps/web/src/AccountGame.tsx`, `account-api.ts`, `account-trace.ts`, `checkpoint-backoff.ts` | Account lifecycle, bounded authenticated requests, shared checkpoint retry deadlines, exact input transport and validated IndexedDB recovery |
| `services/platform/app`, `services/platform/migrations` | Telegram auth, signed tokens, rotating refresh sessions, account lookup and idempotent completion inbox |
| `services/platform/app/economy` | Wallet ledger, gated completion settlement, catalog, inventory, revisioned equipment, atomic purchases and operator worker/audit commands |
| `services/core/typescript` | TypeScript Core HTTP authorization, replay, run ownership, checkpoints, migrations and outbox |
| `deploy` | Compose, gateway routing, isolated development credentials and cross-service smoke |
| [GameButton.tsx](../apps/web/src/GameButton.tsx), [GameSettings.tsx](../apps/web/src/GameSettings.tsx) | Shared button variants/input isolation, and the settings menu |
| [AccountHud.tsx](../apps/web/src/AccountHud.tsx), [useDialogKeyboard.ts](../apps/web/src/useDialogKeyboard.ts) | Shared account HUD layout and keyboard handling for the settings and account shop dialogs |
| [useGameRun.ts](../apps/web/src/useGameRun.ts) | Run descriptors, lifecycle, queued input, fixed-step advancement |
| [clock.ts](../apps/web/src/clock.ts), [input.ts](../apps/web/src/input.ts) | Tick scheduling and accepted pointer/keyboard actions |
| [GameCanvas.tsx](../apps/web/src/GameCanvas.tsx) | Serialized Pixi lifecycle and frame presentation |
| [scene.ts](../apps/web/src/scene.ts), [appearance.ts](../apps/web/src/appearance.ts), [feel.ts](../apps/web/src/feel.ts) | Scene drawing, physics-neutral palettes, bounded cosmetic effects |
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
| Controls, pause/resume, startup/restart | `useGameRun`, `clock`, `input` | Relevant Vitest tests |
| Appearance or viewport | `scene`, `appearance`, `GameCanvas`, `feel`, `style.css` | Relevant unit cases |
| Account balances or best | `AccountWallet`, Economy settlement and ledger, Core account progress | Relevant service and client tests; integration checks when required |
| Sound/music | `audio`, `useGameAudio` | Audio unit cases |
| Physics, gaps, speed, scoring, pickups | TypeScript simulation | Semantic and fixture tests |
| Descriptor/config/state/event shape | Simulation, descriptor schema, fixtures and browser consumers | Schema/fixture tests; review identity compatibility |
| Documentation | Relevant current document and documentation map | Local links and diff review |

## Presentation and cosmetics

The 360 × 580 playfield scales as a unit inside Telegram's stable viewport and
safe areas. Keep controls and cards inside the frame, allow cards to scroll on
short screens, and hide keyboard-only hints on touch devices. Preserve visible
keyboard focus and equivalent Russian and English copy.

Economy owns the [offer catalog](../services/platform/app/economy/shop/catalog.py),
ownership and equipment. The client maps item IDs to procedural palettes in
[account-shop-assets.ts](../apps/web/src/account-shop-assets.ts) and shows them in
the account shop preview and the game. Update both locales and verify the preview,
purchase and equipped appearance when adding an offer. Cosmetics leave simulation
identity, hitboxes and replay unchanged.

## Browser lifecycle

`GameCanvas` and the account shop preview serialize Pixi initialization and
disposal. A late initialization must never attach a canvas after unmount.
Destroy each application without clearing global Pixi resources shared by the
other renderer. Reduced motion preserves readable tilt and disables parallax,
particle effects and flap overshoot.

`useGameAudio` owns the controller and persists sound and music preferences.
Unlock audio from a trusted user gesture. Music runs during active flight, and
nodes and timers are released on mute, backgrounding or disposal. Keep audio
failures separate from simulation state and verify physical playback on a device.

## Check locations and build boundaries

- Root `package.json` defines the operational commands. There is one npm
  workspace/lockfile for `apps/web` and `packages/game-sim`.
- The simulation package exports `dist/index.js`. The dev, typecheck and build
  commands compile it from source.
- Vitest covers the web client, simulation rules, frozen replay fixtures and Core.
  It aliases the simulation package to source. Core's database tests run when
  `CORE_TEST_DATABASE_URL` is set.
- `npm run check` runs types, lint, tests and build. Platform and database checks
  are listed in the [root README](../README.md).

## Runtime limits and performance evidence

The scheduler executes at most five 60 Hz ticks per frame. A frame gap or
accumulated backlog above 250 ms clears timing debt and requests a pause before
executing that frame's ticks. The clock stays latched until explicit resume;
idle/paused/dead presentation does not accumulate simulation debt. Interpolation
is bounded to 0–1. Inputs queued before an overload pause are discarded.

Account progress uses verified completion evidence and never imports browser
balances. Frozen client snapshots cannot transfer authority to client balances.
Paid continue transitions and their accounting remain feature work.

Simulation benchmarks do not measure HTTP/database throughput or production player capacity.
