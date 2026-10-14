# Pixi renderer lifecycle

PixiJS 8.22.0 initializes graphics render data from `PoolGroup.BigPool` in `GraphicsContextSystem._initContextRenderData`; `BatcherPipe` builds batchers per instruction set. The reported failure in `DefaultBatcher.break()` / graphics render-data setup is consistent with shared pooled renderer state being invalidated during overlapping renderer lifecycles, though the original console failure was not independently reproduced in this run. A React StrictMode effect cleanup can run while `Application.init()` is still pending, allowing the old renderer's late cleanup to overlap a subsequent mount. The app now serializes initialization and destruction through a module-level promise queue. Unmount marks its effect disposed immediately, so late initialization cannot attach a canvas, render, or report readiness; its queued cleanup runs after init settles and before the next renderer starts.

The app initialization rejection path remains a visible renderer error; renderer failures are not suppressed. StrictMode remains enabled.

## Regression verification

Run `npm test -- --run apps/web/test/renderer-lifecycle.test.ts`. The deferred-init test asserts that a second initialization cannot overtake the first initialization or its stale cleanup.

For an isolated development-browser stress check, start Vite on `127.0.0.1:4173`, then launch Playwright Chromium with SwiftShader and capture `pageerror` and console errors while repeatedly reloading `/`. Each settled page must have exactly one accessible canvas and no renderer errors. Keep this dev-server probe separate from `npm run test:browser`, which exercises the isolated production preview on port 4174.
