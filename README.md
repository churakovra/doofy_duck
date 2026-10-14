# Doofy Duck

Doofy Duck targets a commercial Telegram Mini App for players aged 18+, in Russian
and English. The approved [product vision](docs/PRODUCT_VISION.md) defines the first
public version and later rewards. The repository currently provides a local
gameplay foundation, not that commercial release.

A locally playable endless pipe game: tap to flap, pass pipes for points, collect occasional Feather/GameStar pickups into a local in-game wallet, pause, die, and restart. React/PixiJS presents a pure TypeScript simulation; a native Go package checks the same full-state/event fixtures.

This is a local development foundation, **not a commercial release**. No accounts, authoritative wallet, payments, gift redemption, paid advantages, leaderboards, or live valuable rewards. Art is placeholder work, not an approved visual direction.

## Project navigation

- [Product vision](docs/PRODUCT_VISION.md): approved purpose, audience, public-version scope, and open decisions.
- [Agent instructions](AGENTS.md): working conventions and task-based model routing.
- [Code map](docs/ARCHITECTURE.md): runtime flow, file ownership, and checks by task.
- [Documentation map](docs/README.md): current rules, product vision, future architecture, and supporting research.
- [Latest recorded verification](docs/ARCADE_FIXES_RESULTS.md): executed checks and remaining acceptance work.

## Requirements

Verified local tools: Node.js26.7.0, npm11.19.0, Go1.27.2. Direct JavaScript dependencies are exact-pinned in package.json/package-lock.json; Go uses only the standard library. The package engine requirements currently need Node26, not an arbitrary older LTS. No Python, PostgreSQL, RabbitMQ, Docker, bot token, or cloud server is needed for this slice.

## Start locally

From this directory:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173/`. The root dev command builds the simulation workspace entrypoint before starting Vite; a clean workspace does not need pre-existing dist files. Leave the terminal running. The server binds to localhost only. If the port is occupied, use the existing project server or deliberately stop it rather than silently starting on an unknown port.

Touch/click the field or press Space to flap. Screen buttons do not also flap. Backgrounding pauses; returning requires explicit resume. Restart is free. Personal best is untrusted local storage, not an online score.

## Latest playtest update

- The wallet displays cumulative balances separately from completed-run earnings and saves locally after death. It is not an account, a Telegram Stars balance, or a redeemable reward. Earlier unsaved earnings cannot be recovered.
- One tab at a time owns the persistent wallet. Close the first tab and reload the second to transfer ownership. If browser locking/storage is unavailable, play remains available with an explicitly non-persistent memory wallet.
- Active-time world speed rises from180 to348pixels/second over45seconds, then score adds speed in10% steps per10 passed pipes until the cap. Pausing freezes the ramp; restarting resets it.
- Velocity tilt, wing/flap motion, restrained squash/stretch and bounded visual effects improve feedback without changing authoritative hitboxes. Extra motion respects the reduced-motion setting.
- Original synthesized flap/pickup/death sounds and a quiet music loop unlock from a user gesture. Separate sound/music controls are saved locally; backgrounding and pause silence playback.

The current rules use simulation version1.2.0, generator version1.1.0, and default config ID `dd-v1-arcade-v2`. See [`docs/ARCADE_SIMULATION.md`](docs/ARCADE_SIMULATION.md) for the rules.

## Verification commands

```sh
npm run typecheck
npm run lint
npm test
npm run test:go
npm run test:go:race
npm run test:parity
npm run build
npx playwright install chromium  # one-time browser prerequisite
npm run test:browser
npm run test:dev                # isolated Vite development browser checks on 127.0.0.1:4175
npm run check                   # types, lint, unit/fixture tests, Go tests, production and development browser suites
```

Native-only commands:

```sh
go -C services/core/simulation test -count=1 -v ./...
go -C services/core/simulation test -race -count=1 ./...
go -C services/core/simulation vet ./...
```

Playwright starts an isolated **production preview on127.0.0.1:4174** and an isolated **development server on127.0.0.1:4175**. Both suites disable server reuse so they test the configured build and source reliably. Browser screenshots are saved as test artifacts, not written over documentation images. CI configuration includes Node and Go checks; a committed workflow file is not evidence of a GitHub-hosted run.

## Source layout

- `apps/web`: renderer and HUD, run/progress/audio hooks, fixed-step scheduler, local storage, browser tests.
- `packages/game-sim`: pure deterministic TypeScript rules and semantic/fixture tests.
- `services/core/simulation`: native Go rules and parity verification; no HTTP service.
- `contracts/simulation`: exact rules, authored pattern catalog, canonical fixtures and offline producer.
- `docs/PRODUCT_VISION.md`: approved product purpose and commercial scope.

For protocol details, read `contracts/simulation/README.md`. Do not change expected fixtures to hide a mismatch. `generate-fixtures.mjs` is a deliberate reviewed maintenance tool, never an automatic testing step.

## Known release boundaries

Browser automation is isolated Chromium, not physical touch or Telegram evidence. Real Telegram desktop/mobile checks, named-device performance/heap measurements, and user gameplay assessment remain separate acceptance gates. Opening a web page inside Telegram does not establish authentication, age eligibility, payment support, or production readiness.

Only the declared default physics/catalog have the documented surviving-controller evidence. Custom configs have distinct content identities but do not inherit a universal reachability guarantee. Replay verification does not prove a human played.
