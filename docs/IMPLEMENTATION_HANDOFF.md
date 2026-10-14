# Doofy Duck — local foundation implementation handoff

Status: local practice implementation and automated verification complete; not tagged/released as v1.0.0. Physical Telegram/mobile acceptance and named-device performance assessment remain pending. No agents are required to keep the app running; the Vite process is separate.

## Implemented

- Tap/Space flight, gravity, stable collision rules, terminal death and immediate restart.
- Seed-selected authored pipe patterns, a safe opening, one point per passed pair, bounded live-world cleanup.
- Configurable CollectibleType/Feather/GameStar implementations, weighted NONE spawning, once-only pickup events and practice run totals.
- READY/RUNNING/PAUSED/DEAD screens, fixed logical playfield, resizing, visibility/overload pause and explicit resume.
- Personal-best storage adapter that tolerates unavailable storage; bounded input queue and reset/sequence handling.
- Serialized Pixi lifecycle, visible renderer failure and input gating until ready.
- Pure TypeScript simulation plus native Go counterpart, versioned descriptors/configuration and full raw-JSON state/event fixture checks.
- Pinned npm dependencies, lockfile, build/check scripts, README and CI configuration. No remote CI execution is claimed.

## Run

The existing main development process serves `http://127.0.0.1:4173/` on localhost. To start from this workspace when it is not already running:

```sh
npm ci
npm run dev
```

`npm run dev` first builds the simulation package. No database, broker, Python services, bot token or paid provider is needed for the local foundation.

## Parent-verified checks

A fresh source copy, excluding node_modules and built dist artifacts, passed:

- npm ci (zero reported vulnerabilities; install-script approval warnings were reported, not silently approved).
- npm run check: typecheck, lint,72 unit/contract tests, Go tests, production build and9 isolated Chromium browser tests.
- Go race tests and vet.

Additional checks: npm run test:parity, gofmt, main-server HTTP200, and10 isolated development-page reloads with one canvas and no console/page errors. A scratch-only server also verified the root startup command; it was stopped and is not the main app.

Go parity uses unchanged foundation-2 fixtures:9 cases,24 operations,24200 advance ticks,5 rejected-input cases and4 mixer vectors. Expected JSON is compared raw, not normalized through the runtime structs. Negative harness tests verify missing fields are detected.

Independent reviews: default core/reachability reviewed; final frontend review reports no further reproduced blocker; GO_REVIEW_FOLLOWUP.md passes the focused corrections and raw-fixture checks. Earlier failed review snapshots remain in docs as history, not current unresolved verdicts.

## Remaining acceptance and limits

- Real Telegram desktop/mobile launch, physical touch, viewport and background/resume behavior.
- Named-device performance/heap measurements and owner feedback on game feel.
- No production age/identity verification, HTTP backend, wallet, payment, gifts, shop, leaderboard or monetized reward promise. Internal counters are practice only.
- Art is deliberately placeholder, not selected final design.
- The documented default-controller/corridor witness does not prove every player state is recoverable or arbitrary custom configurations are feasible. Finite fixture agreement is not exhaustive API equivalence or bot-proofness.
- No Git repository/remote, commits, version tag or public deployment was created.

See GAME_V1_SPEC.md / GAME_V1_TECH_PLAN.md for scope, contracts/simulation/README.md for exact rules, INTEGRATION_VERIFICATION.md for execution history, and README.md for commands. The next step is an owner playtest of the local game, followed by explicitly scoped Telegram/device acceptance—not more product features.
