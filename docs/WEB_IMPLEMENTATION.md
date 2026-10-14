# Web implementation handoff

> Historical frontend foundation handoff. The hook ownership, local wallet, and
> current rules have evolved since this checkpoint. Use the
> [code map](ARCHITECTURE.md) and [documentation map](README.md) for current routing.

**Parent verification update:** the current combined suite passed66 unit/contract tests, root typecheck and lint. An initial browser run exposed a development renderer failure (Pixi batcher null during draw) and showed the test harness was reusing the development server despite a production-build claim. The harness now starts a dedicated non-reused preview on127.0.0.1:4174; a fresh production build and all8 browser checks passed. Development server remains127.0.0.1:4173. Renderer initialization/destruction is now serialized with a deterministic lifecycle regression; the parent also ran10 development-page reloads with one canvas and no console/page errors. The original exception's exact root cause was not independently reproduced, so this does not establish it conclusively. Earlier transient core/lint/type failures below were from concurrent work and do not describe the latest parent checkpoint.

## Delivered

`apps/web` is the browser UI shell for the existing `@doofy-duck/game-sim` module, not a second simulation. `Game.tsx` advances the imported immutable run state at 60 fixed ticks/s and updates React only for phase/HUD changes. `GameCanvas.tsx` owns one asynchronous PixiJS app and draws a single fixed 360×580 milli-pixel viewport; the canvas is centered/letterboxed in CSS on resize. All drawn figures are intentionally original geometric placeholders.

Screen states: READY (button, playfield pointer, or Space starts and flaps once), RUNNING (score, practice counters, pause), PAUSED (explicit resume without flap), and DEAD (completed score/local best/restart). The UI displays Russian labels and identifies GameStar as practice. No account, Telegram SDK, wallet, payment, auth, fake age check, or external font/network request is used.

Pointer input is one `pointerdown` path on the playfield. React screen controls stop pointer bubbling and act on `click`, so their activation cannot also flap; genuine separate taps remain distinct. Space ignores OS repeat and remains latched until keyup. The pending-input queue is capped at eight frames; only accepted frames consume a sequence number. Every discard path (manual/visibility/overload pause, resume, restart, teardown, or fatal error) re-aligns the next sequence to the simulation's `nextInputSequence`. A core-step error is surfaced and stops simulation input/advancement rather than silently clearing the queue. Renderer initialization and draw/resize failures show an error and block starting; simulation does not run ahead of renderer readiness. `localStorage` is schema/version checked behind safe accessors; read/parse/write failures do not block input or restart. The scheduler caps catch-up at five ticks per callback and pauses/clears debt after a >250ms gap. Visibility loss pauses, discards queued input, and requires button resume.

## Versions installed (exact direct pins)

Registry metadata (`npm view ... version/engines/peerDependencies`) was checked before install. All direct packages are pinned in `package.json` and `package-lock.json`; Node v26.7.0/npm 11.19.0 were the observed local runtime.

- `react`, `react-dom` 19.3.0; `@types/react`, `@types/react-dom` 19.3.0
- `pixi.js` 8.22.0
- `vite` 7.3.7; `@vitejs/plugin-react` 5.2.0
- `vitest` 5.0.4; `@playwright/test` 1.64.1; `jsdom` 30.1.2
- Existing TypeScript 5.9.3 / ESLint 10.12.0 / typescript-eslint 8.71.2 pins retained.

An initial attempted combination of latest plugin-react 6.1.2 and Vite 7.3.7 was rejected by npm because plugin-react 6 requires Vite 8. Switched to plugin-react 5.2.0, whose peer range includes Vite 7; installs completed without `--force`/legacy peer override. `npm audit` during dependency adds reported 0 vulnerabilities.

## TDD and executed evidence

- `apps/web/test/runtime.test.ts` was authored before `clock.ts`, `input.ts`, and `storage.ts`. Initial test execution exposed missing modules (setup, not behavioral RED); after minimal implementations, the fixed-step assertion produced real behavioral RED: 50 ms at 60 Hz yielded 2 ticks instead of 3 due to floating-point accumulator drift. An epsilon comparison/clamped remainder fixed that exact expectation. Focused re-run: 4 tests passed (clock whole ticks/work-bound/long-gap handling, key-repeat latch and pointer button isolation, storage corruption/unavailability/write failure). Full core+web unit suite subsequently passed 19 tests.
- The first Playwright attempt exposed a browser installation prerequisite (not an application failure); installed the pinned Playwright Chromium locally. A visibility probe initially dispatched loss before READY had advanced to RUNNING; the test now awaits that transition. A production-build run also showed that waiting on the transient RUNNING banner after a one-flap button start can miss the short run and observe its legitimate DEAD result instead; the lifecycle test uses Space before exercising pause/resume/death/restart, while the button-start path is exercised by the resize/visibility test.
- Production browser suite: `npm run test:browser` — 8/8 passed in Chromium, including short 844×390 and 320×390 containment/fixed-ratio checks; primary touch and button isolation; a queued touch across pause/resume; renderer failure blocking start; a 40-event input burst; existing lifecycle and visibility checks. The sequence test was first run with sequence realignment temporarily removed and failed because the next post-resume step emitted the visible simulation error; restoring realignment made it pass. The short-viewport test was first run against the original 440px minimum shell and failed on the assertion that the shell bottom be within the 390px viewport (observed 440px). No physical-device, Telegram, or real-touch claim is made; pointer tests use browser-dispatched touch-type PointerEvents.
- Focused web checks passed: `npx vitest run apps/web/test/runtime.test.ts` (4/4), `npx tsc -p apps/web/tsconfig.json`, web-only ESLint, and production build. The combined root checks are currently affected by concurrent out-of-scope core edits: `npm test` has 1 core assertion failure (`nextSpawnPipeIndex`, expected 4, got 3); root `npm run lint` reports unused `PATTERN_CATALOG` in `packages/game-sim/test/stabilization.test.ts`; latest root `npm run typecheck` stops in `packages/game-sim/test/fixtures.test.ts` because it cannot resolve `node:fs`. These core files were not changed here.

## Commands

```sh
npm ci
npm run dev --workspace @doofy-duck/web -- --host 127.0.0.1
npm run typecheck
npm run lint
npm test
npx playwright install chromium   # once per machine
npm run test:browser
npm run build                     # simulation dist first, then production web dist
```

Vite/preview host is pinned to `127.0.0.1`. GitHub Actions runs install, typecheck, lint, core/web unit tests, Chromium browser checks, and production build. Do not omit the simulation build: the workspace package export intentionally points to its compiled `dist/index.js` entry.

## Limits

Browser evidence is Chromium desktop emulation only. No iOS/Android browser, Telegram WebView/client, physical touch behavior, performance target, long-run heap, accessibility audit, CI-host run, or Go parity was exercised. Best score is untrusted local convenience storage. It is not account data, a leaderboard, or a redeemable balance. Core-generated default patterns/config are consumed as supplied; this UI makes no feasibility or reward guarantees beyond the tests above.
