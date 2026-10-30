# Doofy Duck

Doofy Duck is an account-backed Telegram Mini App game in development. React and
PixiJS render a deterministic TypeScript simulation; a TypeScript service independently replays and verifies runs;
a Python platform manages accounts, wallets and cosmetics in PostgreSQL. The
[product vision](docs/PRODUCT_VISION.md) describes intended features; this is not
yet a commercial release.

## Run locally

Install Node.js, npm, Go, Python, uv and Docker Compose. The pinned toolchain is
listed in the repository configuration. With Docker running:

```sh
make install
make run
```

Open http://127.0.0.1:4173/. Local startup creates or preserves `.env.dev`, starts
PostgreSQL and the backend, and connects a development Telegram identity. Ctrl-C
stops Vite; `make stop` stops the containers without deleting database data.
`make status` and `make logs SERVICE=platform` inspect the stack. Use
`make run DEV_USER_ID=123456` for another local identity.

Local credentials and development authentication are not for public deployment.
Production uses validated Telegram launch data; see [Telegram setup](docs/TELEGRAM_BOT_SETUP.md).
The local economy is enabled unless explicitly disabled in `.env.dev`; production
activation is separate. Internal coins and game Stars are not Telegram Stars.

## Checks

```sh
npm run check                    # types, lint, JS/Go tests and build
npm run check:backend            # Python and Go backend checks
npm run test:parity              # shared simulation fixtures
npm run check:backend:smoke      # cross-service smoke, after local startup
npm run check:backend:integration # requires dedicated PostgreSQL test databases
```

Integration checks require `PLATFORM_TEST_DATABASE_URL`, `ECONOMY_TEST_DATABASE_URL`
and `CORE_TEST_DATABASE_URL` pointing to dedicated test databases. Unit checks
skip database-dependent tests when their URLs are absent. Browser checks are
optional: install Chromium with `npx playwright install chromium`, then run
`npm run check:browser`. See [backend operations](docs/BACKEND_OPERATIONS.md)
for configuration and recovery.

## Repository

- `apps/web`: Telegram-facing React/PixiJS application.
- `packages/game-sim`: deterministic TypeScript gameplay rules.
- `services/core/typescript`: TypeScript run verification service and migration runner.
- `services/core/backend` and `services/core/simulation`: retained Go implementation and parity tests.
- `services/platform`: Python authentication, accounts and economy.
- `contracts`: HTTP, event and versioned simulation contracts and fixtures.
- `deploy`: local stack, gateway and operational helpers.
- `docs`: [architecture](docs/ARCHITECTURE.md), [simulation](docs/ARCADE_SIMULATION.md),
  [operations](docs/BACKEND_OPERATIONS.md) and [other current guidance](docs/README.md).

Core, Platform and Economy use separate PostgreSQL databases. Verified run
completions travel through a durable Core outbox and Platform inbox before the
settlement worker credits the wallet. Existing migrations and historical
simulation contracts are needed for compatibility; do not delete or regenerate
fixtures merely because they describe older versions.

Real Telegram device acceptance, hosted capacity and production economy
activation remain open. Replay verification does not prove a human played.
