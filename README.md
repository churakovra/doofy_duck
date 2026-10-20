# Doofy Duck

Doofy Duck targets a commercial Telegram Mini App for players aged 18+, in Russian
and English. The approved [product vision](docs/PRODUCT_VISION.md) defines the first
public version and later rewards. The repository provides one account-backed game
in local development and Telegram.
React/PixiJS presents the shared TypeScript simulation; Go verifies runs, and
Python/PostgreSQL persist accounts, wallets, purchases and equipment. Anonymous
practice and the local/account mode selector have been removed.

This is a development foundation, **not a commercial release**. Local startup
connects a development Telegram identity and enables verified pickup settlement
and the cosmetic shop unless explicitly disabled in local configuration. Production
requires real Telegram authentication and separate economy activation. Paid
continue, XTR funding, gifts and leaderboards remain unimplemented. Hosted capacity
and real Telegram acceptance remain open; see the
[backend implementation record](docs/BACKEND_FOUNDATION.md).

## Project navigation

- [Product vision](docs/PRODUCT_VISION.md): approved purpose, audience, public-version scope, and open decisions.
- [Repository map](AGENTS.md): project purpose and source locations.
- [Code map](docs/ARCHITECTURE.md): runtime flow, file ownership, and checks by task.
- [Foundation](docs/FOUNDATION.md): extension points for rules, cosmetics, and event consumers.
- [Documentation map](docs/README.md): current rules, product vision, future architecture, and supporting research.
- [Telegram bot setup](docs/TELEGRAM_BOT_SETUP.md): automatic launch identity and first real-bot test.
- [Unified account game](docs/UNIFIED_ACCOUNT_GAME.md): single game path, complete local startup and verification.
- [SHOP implementation](docs/SHOP_IMPLEMENTATION_RESULTS.md): delivered wallet/inventory/purchase code and verification limits.
- [Backend verification](docs/BACKEND_FOUNDATION.md): ACCOUNT/RUN checks, capacity measurements and external acceptance gates.
- [Challenge verification](docs/CHALLENGE_RESULTS.md): October 17 challenge checks and bounded physics evidence.
- [Wetland challenges](docs/WETLAND_CHALLENGES.md): varied obstacles, collectible routes, compatibility and current verification status.

## Requirements

Local verification toolchain: Node.js 26.11.1, npm 11.20.0, Go 1.27.2.
Direct JavaScript dependencies are exact-pinned in package.json/package-lock.json.
Running the game also requires Docker Desktop/Compose, Python 3.15.0 and uv 0.13.1.
The backend uses PostgreSQL 18.0; RabbitMQ is deferred.

## Start locally

From this directory, with Docker running:

```sh
make install
make run
```

Open `http://127.0.0.1:4173/`. The game connects a persistent development Telegram
account automatically. This is a development identity, not proof of a real Telegram
login. Local gameplay uses the same account/run, wallet, shop and equipment paths
as Telegram gameplay. Production signs players in with Telegram initialization
data and never falls back to development login.

`make run` preserves existing `.env.dev` credentials and settings, adds missing
local economy settings with a one-time UTC settlement cutoff, starts the backend
and settlement worker, then keeps Vite in the foreground. Ctrl-C stops Vite;
`make stop` stops the containers while preserving PostgreSQL data. `make status`
shows service status and `make logs SERVICE=platform` follows one service.
`make run-account` is a compatibility alias for the same startup. Use
`make run DEV_USER_ID=123456` to configure another development identity. The
configured identity is connected automatically; there is no in-game account selector.

The API and local static build are at `http://127.0.0.1:8080/`. Vite proxies the
same API. `npm run dev` starts only the frontend; use `make run` for the complete
local stack and automatic development sign-in. If the backend is unavailable,
retry the connection; the app does not substitute a browser-only game or wallet.
Never use ignored local credentials or development-auth builds publicly.

Coins and in-game Stars collected during verified runs settle into the account
wallet through the background worker. The shop uses account balances and owned
items. Explicitly disabled economy settings in `.env.dev` stay disabled. Facts
completed before the saved cutoff are not automatically credited, and earlier
browser-only balances and equipment are not imported. Actual Telegram Stars (XTR)
remain separate from both internal currencies.

Open Menu before a flight, while paused or after a run to choose Русский or English
and control sound effects and music. These device preferences survive reload when
browser storage is available. The account shop previews skins and backgrounds;
owned equipment persists in PostgreSQL. Cosmetics never change physics or hitboxes.

Touch/click the field or press Space to flap. Buttons do not also flap. The game
pauses when backgrounded and requires explicit resume. New runs are free. Account
runs retain unsent inputs on this device where storage permits, and an already
started flight can finish through an outage. A completed unresolved run waits for
verification before another flight starts; receipt delivery retries independently.
Device takeover requires confirmation. A flight ends after at most one hour of
active time; pauses do not consume active ticks.

Automatic session refresh requires browser Web Locks and writable local storage.
If refresh cannot complete, the app reconnects the same launch identity where
possible; pending runs stay on the server.
IndexedDB failure separately warns that closing the page may lose unsent inputs.
Verified results can be reopened after automatic connection or reload, including on another
device. The game has no sign-in or logout controls. Outside Telegram, the normal
build requires a Telegram launch; a saved cookie does not bypass this. See
[bot setup](docs/TELEGRAM_BOT_SETUP.md) for the first real Telegram test.

Run the cross-service smoke after startup:

```sh
npm run check:backend:smoke
```

It uses disposable development accounts to check ownership, replay, positive
pickup settlement, shop/equipment reads, re-login persistence and completion
delivery. See [service contracts](contracts/http/account-auth-v1.md), the
[Core API](contracts/http/core-run-v1.md), the
[wallet contract](contracts/http/economy-wallet-v1.md) and the
[operations runbook](docs/BACKEND_OPERATIONS.md). Production activation, hosted
capacity and real Telegram/device acceptance are separate gates.

## Current gameplay

- Wallet balances, purchases and equipment belong to the signed-in account. Verified completed-run pickups become spendable after settlement; pending rewards are shown separately. In-game Stars are not Telegram Stars or redeemable rewards.
- One writer controls an active account run. Another tab or device must explicitly take over; account ownership and server verification govern persistent progress.
- Seeded four-station wetland encounters use paired pipes with authored 240/300/360-pixel spacing. Two introductory families lead into alternating pressure and recovery routes. Optional coin trails and scheduled Stars reward harder flight paths. Pause freezes play and restart resets the schedule. Mixed obstacles remain supported by their frozen legacy identities for future development.
- Active-time world speed ramps from 180 to 288 pixels/second over 45 seconds. Score adds speed in 10% steps per 10 cleared obstacle stations until the same cap, which can be reached earlier. Each station scores once, including a pair of pipes.
- Optional coin routes and seeded Stars reward harder flight paths. Verified coin credit retains its 30-per-run wallet cap; collecting more does not raise that cap. See the wetland record for controller evidence and remaining owner playtesting.
- Velocity tilt, wing/flap motion, restrained squash/stretch and bounded visual effects improve feedback without changing authoritative hitboxes. Extra motion respects the reduced-motion setting.
- Original synthesized flap/pickup/death sounds and a quiet music loop unlock from a user gesture. Separate sound/music controls are saved locally; backgrounding and pause silence playback.

The shared simulation default uses version 2.2.0, generator 2.2.0 and config ID `dd-v2-paired-routes-v1`. New account runs use that identity; existing catalog-2 `2.1.0`, wetland `2.0.0`, and earlier runs retain their original rules. See [`docs/ARCADE_SIMULATION.md`](docs/ARCADE_SIMULATION.md) for the rules and [wetland challenges](docs/WETLAND_CHALLENGES.md) for verification status.

## Verification commands

```sh
npm run typecheck
npm run lint
npm test
npm run test:go
npm run test:go:race
npm run test:parity
npm run build
npm run check                   # routine: types, lint, unit/fixture tests, Go tests, build
npm run check:backend           # Python lint/types/unit and Core unit/race/vet
npm run check:backend:integration # requires all three dedicated PostgreSQL test URLs

# Optional browser verification, only when requested:
npx playwright install chromium  # one-time browser prerequisite
npm run test:browser             # production browser suite
npm run test:dev                 # development browser suite; run separately after production
npm run check:browser            # both browser suites, sequentially
npm run check:full               # routine checks followed by both browser suites
```

Backend integration uses `PLATFORM_TEST_DATABASE_URL`, `ECONOMY_TEST_DATABASE_URL`
and `CORE_TEST_DATABASE_URL` against dedicated `*_test` databases. The integration
command fails when these variables are absent. Native Python needs libpq for
PostgreSQL tests; `services/platform/Dockerfile.test` supplies a pinned Linux test
environment. Unit-only checks explicitly report database tests as skipped when
URLs are absent. Backend CI defines real PostgreSQL checks; a committed workflow
is not evidence of a hosted CI run.

Native-only commands:

```sh
go -C services/core/simulation test -count=1 -v ./...
go -C services/core/simulation test -race -count=1 ./...
go -C services/core/simulation vet ./...
go -C services/core/simulation test -run '^$' -bench 'BenchmarkDefault(Step|Replay300Ticks)$' -benchmem -count=3
```

Playwright starts an isolated **production preview on127.0.0.1:4174** and an isolated **development server on127.0.0.1:4175**. Browser suites use one worker to isolate software-rendering load. Run the two suites sequentially because they share their artifact directory. Both suites disable server reuse so they test the configured build and source reliably. Browser screenshots are saved as test artifacts, not written over documentation images. Push/PR CI runs routine Node/Go checks without installing or launching Chromium. Browser checks are available through a manual workflow run with `browser_tests` enabled. A committed workflow file is not evidence of a GitHub-hosted run.

## Source layout

- `apps/web`: renderer and HUD, run/progress/audio hooks, fixed-step scheduler, local storage, browser tests.
- `packages/game-sim`: pure deterministic TypeScript rules and semantic/fixture tests.
- `services/core/simulation`: native Go rules and parity verification.
- `services/core/backend`: Go HTTP verification, PostgreSQL checkpoints and completion outbox.
- `services/platform`: Python identity/sessions and Economy completion inbox; no account issuance.
- `deploy`: isolated local Compose, gateway templates, credential helper and end-to-end smoke.
- `contracts/simulation`: exact rules, authored pattern catalog, canonical fixtures and offline producer.
- `docs/PRODUCT_VISION.md`: approved product purpose and commercial scope.

For protocol details, read `contracts/simulation/README.md`. Do not change expected fixtures to hide a mismatch. `generate-fixtures.mjs` is a deliberate reviewed maintenance tool, never an automatic testing step.

## Known release boundaries

Browser automation is isolated Chromium, not physical touch or Telegram evidence. Real Telegram desktop/mobile checks, named-device performance/heap measurements, and user gameplay assessment remain separate acceptance gates. Opening a web page inside Telegram does not establish authentication, age eligibility, payment support, or production readiness.

Only the declared default physics/catalog have the documented surviving-controller evidence. Custom configs have distinct content identities but do not inherit a universal reachability guarantee. Replay verification does not prove a human played.
