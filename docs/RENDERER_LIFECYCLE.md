# Pixi renderer lifecycle

A React StrictMode effect cleanup can run while `Application.init()` is still pending, allowing the old renderer's late cleanup to overlap a subsequent mount. The app now serializes initialization and destruction through a module-level promise queue. Unmount marks its effect disposed immediately, so late initialization cannot attach a canvas, render, or report readiness; its queued cleanup runs after init settles and before the next renderer starts.

The app initialization rejection path remains a visible renderer error; renderer failures are not suppressed. StrictMode remains enabled.

## Regression verification

Run `npm test -- --run apps/web/test/renderer-lifecycle.test.ts`. The deferred-init test asserts that a second initialization cannot overtake the first initialization or its stale cleanup.

Run `npm run test:dev` for the isolated development-browser checks on
`127.0.0.1:4175`. The suite tests StrictMode startup and reload behavior with one
canvas and usable start controls. Production checks run separately through
`npm run test:browser` on port 4174.
