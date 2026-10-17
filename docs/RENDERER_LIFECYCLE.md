# Pixi renderer lifecycle

A React StrictMode effect cleanup can run while `Application.init()` is still pending, allowing the old renderer's late cleanup to overlap a subsequent mount. The app now serializes initialization and destruction through a module-level promise queue. Unmount marks its effect disposed immediately, so late initialization cannot attach a canvas, render, or report readiness; its queued cleanup runs after init settles and before the next renderer starts.

The app initialization rejection path remains a visible renderer error; renderer failures are not suppressed. StrictMode remains enabled.

The game and wardrobe preview can own renderers at the same time. Destroy each
application with explicit renderer options that remove its view without releasing
global Pixi resources. In the pinned Pixi version, the boolean `true` destroy
argument also clears global pools; preview cleanup can then invalidate batches
still used by the game. Serializing initialization and destruction alone does
not protect an already mounted renderer from that global cleanup. Child display
objects are disposed without destroying shared cached textures or their sources.

## Regression verification

October 17, 2026 wardrobe cleanup fix: the reported live failure was reproduced
in the in-app browser against the development server. Opening the wardrobe
triggered a null `Batch.textures` error in the game and a static fallback preview.
After preserving global resources in both cleanup paths, manual checks showed
Rose/Dusk and Mint/Winter changing immediately in preview, Apply updating the
game without a reload, equipped selections retained on reopen, and a usable
flight with the new appearance. No new renderer console errors appeared.

Both cleanup call sites have regression assertions. Focused renderer tests,
typecheck, lint and the full routine check passed after the fix (250 unit/fixture
tests, Go tests and build); the routine command used a writable temporary Go
cache. Independent dependency/lifecycle review passed. This targeted manual
browser check is not a run of either Playwright suite, resource-decoding
acceptance, or physical Telegram/device verification.

Run `npm test -- --run apps/web/test/renderer-lifecycle.test.ts`. The deferred-init test asserts that a second initialization cannot overtake the first initialization or its stale cleanup.

Run `npm run test:dev` for the isolated development-browser checks on
`127.0.0.1:4175`. The suite tests StrictMode startup and reload behavior with one
canvas and usable start controls. Production checks run separately through
`npm run test:browser` on port 4174.
