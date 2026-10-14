# Independent web frontend review

> Historical initial review. The viewport finding was addressed before the
> [Final web review](FINAL_WEB_REVIEW.md). See [Arcade fixes results](ARCADE_FIXES_RESULTS.md)
> for the latest recorded integration checks.

**Verdict: `passed: false`** — one reproducible viewport correctness defect. No frontend security concern identified in the reviewed source. This is an initial-source review (workspace is not a Git repository), not a change-diff review.

## Release-blocking correctness issue

- **[P1] Short viewports vertically clip the fixed playfield and bottom HUD.** `apps/web/src/style.css`, `.game-shell` sets `height:100dvh` and `min-height:440px`, while also hiding overflow. When the actual viewport is shorter than 440 CSS px, the game shell is taller than the visible screen and grid-centers its stage/UI within that taller box. I reproduced this with Chromium at **844×390** and **320×390**: the shell reports 440px high, so its bottom 50px are outside the viewport; at 844×390 the nominal 390px-tall canvas is offset about 25px down and clipped. The bottom-anchored wallet/status strip is clipped as well. This contradicts the fixed-playfield/resizing acceptance requirement (spec §8, technical plan TR-07/TR-12). Remove the conflicting minimum height or adapt layout/scale to the actual viewport; verify the entire canvas and all controls remain visible in short landscape and split-screen dimensions.

## Test and acceptance gaps (non-blocking findings; device/parity gates remain unverified)

- **Pointer/touch lifecycle is not covered by browser tests.** `apps/web/test/playwright.spec.ts` starts with Space or a button click, but never verifies a direct field tap, a primary pointer/touch gesture, or that a single touch produces exactly one flap/start. `runtime.test.ts` tests pointer filtering in isolation, not browser event compatibility or first-tap integration. Add browser assertions that distinguish one accepted flap from two, including first interaction and button controls.
- **Persistence integration lacks browser-level coverage.** The storage unit test checks serialization and exceptions, but no browser test asserts best-score update/read across a reload, invalid stored data handling in the app, or that blocked/quota-failing storage leaves restart playable. The implementation catches storage exceptions; the full acceptance path is not demonstrated.
- **Important UI-to-simulation outcomes are not asserted in the browser suite.** Existing E2E checks phase screens, resize ratio, and visibility pause, but not score increment exactly once, collectible totals, final-best persistence, duplicate finalization, or restarting into a new descriptor. These are acceptance gaps, not claims that the simulation rules themselves are wrong.
- **Real device/Telegram and Go parity are not verified here.** Browser automation config targets Chromium/SwiftShader, and the CI workflow invokes Node checks and Playwright but no Go simulation/parity command. The specs explicitly require selected real-device/Telegram evidence and TS/Go golden parity before candidate acceptance. Keep those as explicit, separately recorded release gates.

## Targeted execution notes

- Reviewed all `apps/web/src/**`, `apps/web/test/**`, root/web package manifests, Playwright config, CI workflow, and `GAME_V1_SPEC.md` / `GAME_V1_TECH_PLAN.md`.
- Ran an isolated Chromium probe against the local app. Viewport geometry confirmed the 440px minimum-height overflow at 390px height. A second interaction probe found the Pause button already disabled after the running screen appeared; I did not attribute that behavior to the frontend because the concurrently changing simulation package is explicitly out of scope for final core findings.
- No source implementation files were changed. Parent-reported test/typecheck/lint/build results were not independently rerun here; this review does not claim Go or physical-device checks ran.
