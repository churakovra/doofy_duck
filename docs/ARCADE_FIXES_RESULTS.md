# Arcade integration fixes — verification

Date: 2026-10-14

The browser now creates descriptors from the simulation package’s exported identity, so startup and restart use simulation `1.2.0`, generator `1.1.0`, and config `dd-v1-arcade-v2`. Run lifecycle, wallet/personal-best progress, and audio ownership now live in focused hooks. Initialization errors reach a visible reload screen.

## Checks

- `npm run check` passed: typecheck, lint, 112 unit/fixture tests, native Go tests, production build, 16 production browser tests, and 2 development browser tests.
- `npm run test:go:race` passed.
- `go -C services/core/simulation vet ./...` passed.
- `git diff --check` passed.
- The fixture producer was not run; this fix pass did not rewrite the arcade replay fixture.

Browser coverage includes repeated start/pause/resume/death/restart cycles, StrictMode development startup and reload, descriptor/schema identity, wallet settlement deduplication, queued input, storage failure, audio, visibility pause, renderer failure, and initialization error recovery.

Physical mobile and Telegram client behavior, named-device performance, and owner gameplay assessment remain unverified acceptance work.
