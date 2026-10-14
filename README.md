# Doofy Duck — gameplay foundation

A locally playable endless pipe game: tap to flap, pass pipes for points, collect occasional Feather/GameStar pickups into a local in-game wallet, pause, die, and restart. React/PixiJS presents a pure TypeScript simulation; a native Go package checks the same full-state/event fixtures.

This is a development foundation targeting v1.0.0, **not a commercial release**. No accounts, authoritative wallet, payments, gift redemption, paid advantages, leaderboards, or live valuable rewards. Art is placeholder work, not an approved visual direction.

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
- Active-time world speed rises smoothly from144 to288pixels/second over90seconds, then caps. Pausing freezes the ramp; restarting resets it. This increases pressure rather than imposing a hidden death timer.
- Velocity tilt, wing/flap motion, restrained squash/stretch and bounded visual effects improve feedback without changing authoritative hitboxes. Extra motion respects the reduced-motion setting.
- Original synthesized flap/pickup/death sounds and a quiet music loop unlock from a user gesture. Separate sound/music controls are saved locally; backgrounding and pause silence playback.

The internal simulation version is1.1.0, generator version1.0.0, default config ID `dd-v1-speed-v1`. Detailed scope, verification and remaining gates are in `docs/PLAYTEST_UPDATE.md` and `docs/PLAYTEST_UPDATE_RESULTS.md`; audio research and primary sources are in `docs/TELEGRAM_AUDIO_RESEARCH.md`.

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
npm run check                   # types, lint, unit/fixture tests, Go tests, production browser suite
```

Native-only commands:

```sh
go -C services/core/simulation test -count=1 -v ./...
go -C services/core/simulation test -race -count=1 ./...
go -C services/core/simulation vet ./...
```

Playwright starts its own **production preview on127.0.0.1:4174** with server reuse disabled. It must not borrow the development server on4173. This leaves an existing development session running. CI configuration includes Node and Go checks; a committed workflow file is not evidence of a GitHub-hosted run.

## Source layout

- `apps/web`: renderer, HUD/screens, input, fixed-step scheduler, local storage, browser tests.
- `packages/game-sim`: pure deterministic TypeScript rules and semantic/fixture tests.
- `services/core/simulation`: native Go rules and parity verification; no HTTP service.
- `contracts/simulation`: exact rules, authored pattern catalog, canonical fixtures and offline producer.
- `docs/GAME_V1_SPEC.md`, `docs/GAME_V1_TECH_PLAN.md`: scope and acceptance requirements.

For protocol details, read `contracts/simulation/README.md`. Do not change expected fixtures to hide a mismatch. `generate-fixtures.mjs` is a deliberate reviewed maintenance tool, never an automatic testing step.

## Known release boundaries

Browser automation is isolated Chromium, not physical touch or Telegram evidence. Real Telegram desktop/mobile checks, named-device performance/heap measurements, and user gameplay assessment remain separate acceptance gates. Opening a web page inside Telegram does not establish authentication, age eligibility, payment support, or production readiness.

Only the declared default physics/catalog have the documented surviving-controller evidence. Custom configs have distinct content identities but do not inherit a universal reachability guarantee. Replay verification does not prove a human played.
