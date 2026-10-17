# Doofy Duck

Doofy Duck targets a commercial Telegram Mini App for players aged 18+, in Russian
and English. The approved [product vision](docs/PRODUCT_VISION.md) defines the first
public version and later rewards. The repository currently provides a local
gameplay foundation, not that commercial release.

A locally playable endless pipe game: tap to flap, pass pipes for points, collect occasional coins/in-game Stars pickups into a local in-game wallet, pause, die, and restart. React/PixiJS presents a pure TypeScript simulation; a native Go package checks the same full-state/event fixtures.

This is a development foundation, **not a commercial release**. An optional local
Python/Go/PostgreSQL stack adds Telegram accounts and server-verified runs. Account
currency issuance, purchases, paid continue, gifts and leaderboards remain disabled.
Art is placeholder work. Hosted capacity and real Telegram acceptance remain open;
see the [backend implementation record](docs/BACKEND_FOUNDATION.md).

## Project navigation

- [Product vision](docs/PRODUCT_VISION.md): approved purpose, audience, public-version scope, and open decisions.
- [Agent instructions](AGENTS.md): working conventions and task-based model routing.
- [Code map](docs/ARCHITECTURE.md): runtime flow, file ownership, and checks by task.
- [Foundation](docs/FOUNDATION.md): extension points for rules, cosmetics, and event consumers.
- [Documentation map](docs/README.md): current rules, product vision, future architecture, and supporting research.
- [Backend verification](docs/BACKEND_FOUNDATION.md): ACCOUNT/RUN checks, capacity measurements and external acceptance gates.
- [Challenge verification](docs/CHALLENGE_RESULTS.md): October 17 challenge checks and bounded physics evidence.

## Requirements

Local verification toolchain: Node.js 26.11.1, npm 11.20.0, Go 1.27.2. Direct JavaScript dependencies are exact-pinned in package.json/package-lock.json; the pure Go simulation uses only the standard library. The package engine requirements currently need Node26, not an arbitrary older LTS. Local practice needs no Python, PostgreSQL, Docker, bot token or cloud server. The optional account stack uses Python 3.15.0, uv 0.13.1, pinned pgx dependencies and Docker Compose with PostgreSQL 18.0. RabbitMQ is deferred.

## Start locally

From this directory:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173/`. The root dev command builds the simulation workspace entrypoint before starting Vite; a clean workspace does not need pre-existing dist files. Leave the terminal running. The server binds to localhost only. If the port is occupied, use the existing project server or deliberately stop it rather than silently starting on an unknown port.

Open Menu before a flight, while paused, or after a run to choose Русский or English and control sound effects and music independently. These preferences save on this device when browser storage is available, and changing language preserves the current run. While flying, the screen shows only the score. The game pauses automatically when the app is backgrounded; resume explicitly after returning.

Open Wardrobe / Гардероб before starting, while paused or after a run to preview
and equip a duck skin and background independently. Apply saves the pair on this
device when storage is available; closing discards the preview. The three skins
and three worlds are freely selectable test cosmetics, not account inventory or
approved launch art. See the [cosmetic authoring guide](docs/COSMETICS.md) to add
catalog entries or replace drawings with image assets.

Touch/click the field or press Space to flap. Screen buttons do not also flap. Backgrounding pauses; returning requires explicit resume. Restart is free. Personal best is untrusted local storage, not an online score.

## Account-backed local development

Generate ignored local credentials once, then start the stack from the repository root:

```sh
(cd services/platform && uv run python ../../deploy/scripts/generate-dev-keys.py)
docker compose --env-file .env.dev -f deploy/compose.yaml --profile local up --build -d
npm run dev
```

Open `http://127.0.0.1:4173/`, choose account mode and enter a positive development
Telegram user ID. Vite proxies API requests to the one-origin gateway on port 8080.
The static build is also served at `http://127.0.0.1:8080/`; its production frontend
uses Telegram login, while the development UI is available through Vite. Development
login is explicitly enabled only in the local backend configuration. Never use the
ignored `.env.dev` credentials for a public deployment.

Account runs use server-issued identities and verified checkpoints, retain unsent
inputs on this device where storage permits, and let an already-started flight
finish locally through an outage. A completed unresolved run waits for gameplay
verification before another account flight starts; receipt delivery retries independently.
Device takeover requires
confirmation. A run ends after at most one hour of active flight; pauses do not
consume active ticks. Verified pickups are evidence only: account rewards are not
enabled, and local practice funds are never imported.

Automatic session refresh requires browser Web Locks and writable local storage.
If either is unavailable, explicit reauthentication remains available; pending runs
stay on the server. IndexedDB failure separately warns that unsent inputs may be
lost when the page closes. Verified completed results can be reopened after login
or reload, including from another device.

Run the local cross-service smoke after startup:

```sh
(cd services/platform && uv run python ../../deploy/scripts/backend-smoke.py)
```

This command uses disposable development accounts and checks account ownership,
Go replay, and exactly one stored completion receipt. It requires Docker access.
See [service contracts](contracts/http/account-auth-v1.md), the
[Core API](contracts/http/core-run-v1.md) and the
[operations runbook](docs/BACKEND_OPERATIONS.md). Provider, budget and deployment
approval remain separate; the Compose production overlay is a template, not an
HA deployment or release acceptance result.

The load harness requires development authentication and disposable accounts. Run
only against the local/test stack, with a new account ID range for each experiment:

```sh
uv run --project services/platform --env-file .env.dev go -C services/core/backend run ./cmd/loadtest \
  -core http://127.0.0.1:8080 -platform http://127.0.0.1:8080 \
  -clients 1000 -duration 1h2m -checkpoints-per-second 500 \
  -minimum-checkpoint-rate 475 -telegram-user-id-start 920000000
```

For outage delivery tests, run the harness inside the backend network with direct
operator access to Core and add `-outage-after 2m -outage-duration 5m
-reconnect-spread 1m`. The gateway hides operator routes. Startup retries and measured
checkpoint failures are reported separately; nonzero exit means an acceptance gate
failed. See the [capacity record](docs/BACKEND_FOUNDATION.md) for actual results.

Local settlement and shop mutations remain off by default. To exercise them, set
`ECONOMY_SETTLEMENT_ENABLED=true`, choose an explicit UTC
`ECONOMY_SETTLEMENT_ACTIVATED_AT` cutoff, and optionally set
`ECONOMY_SHOP_ENABLED=true` in `.env.dev`, then restart the Platform service. Run
the settlement worker in a separate terminal; Ctrl-C stops it cleanly:

```sh
docker compose --env-file .env.dev -f deploy/compose.yaml --profile local exec platform \
  /opt/venv/bin/python -m app.economy.settlement_cli worker
```

The worker uses bounded transactions and backs off during database failures.
Production settlement still requires the separate acceptance gates in the
[Economy contract](contracts/http/economy-wallet-v1.md).

## Current gameplay

- The wallet displays cumulative balances separately from completed-run earnings and saves locally after death. It is not an account, a Telegram Stars balance, or a redeemable reward. Earlier unsaved earnings cannot be recovered.
- One tab at a time owns the persistent wallet. Close the first tab and reload the second to transfer ownership. If browser locking/storage is unavailable, play remains available with an explicitly non-persistent memory wallet.
- Seeded four-pipe challenge families introduce steady, rising, falling and offset routes, with recovery blocks after pressure sections. The schedule advances with pipe encounter order; pause freezes play and restart resets the schedule.
- Active-time world speed ramps from180 to288pixels/second over45seconds. Score adds speed in10% steps per10 passed pipes until the same cap, which can be reached earlier. Default pipe spacing is300pixels.
- Velocity tilt, wing/flap motion, restrained squash/stretch and bounded visual effects improve feedback without changing authoritative hitboxes. Extra motion respects the reduced-motion setting.
- Original synthesized flap/pickup/death sounds and a quiet music loop unlock from a user gesture. Separate sound/music controls are saved locally; backgrounding and pause silence playback.

The current rules use simulation version1.3.0, generator version1.2.0, and default config ID `dd-v1-stepped-v1`. See [`docs/ARCADE_SIMULATION.md`](docs/ARCADE_SIMULATION.md) for the rules.

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
