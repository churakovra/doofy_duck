# Flight feel update

## Renderer-only presentation

The duck is now assembled once from body and wing graphics inside a positioned container. Its rotation follows the authoritative vertical velocity (from -0.57 radians upward to 1.25 radians downward, with an immediate flap target of -0.64 radians); a short flap envelope adds a small squash/stretch and wing snap. The wing's idle movement is restrained and only runs during active flight. Existing palette and silhouette are retained.

A soft, sparse background layer shifts subtly with simulation ticks. Static sky and sun remain Pixi's background/static scene; pipe, floor and collectible geometry is rebuilt only when the simulation tick changes, not for every presentation frame. Effects and duck transforms continue to animate within the single existing canvas.

## Bounded effects and determinism

Cosmetic events use a renderer-local monotonic serial (no `Math.random`, no game RNG/state writes). Air puffs spawn every 14 running ticks; newly collected items produce a brief warm ring, and death gets one small accent puff. The shared effect pool is capped at 20 entries and effects expire within 0.56 seconds. Pool overflow drops the oldest entry. There is no screenshake. The optional `getFeedback` callback supports immediate flap serial response; without it, the renderer still animates from state velocity and collectible transitions.

Pause freezes cosmetic time, so effects do not age while paused. A transition to READY clears transient state; the DEAD pose holds the final velocity-derived lean. No per-frame React state is used.

## Reduced motion and safety

With `prefers-reduced-motion: reduce`, the duck retains readable velocity-following tilt, while flap overshoot/squash, idle wing oscillation, parallax travel and particle rendering are disabled. Core gameplay, collision geometry, RNG and hitboxes are unchanged.

Pixi initialization/disposal remains serialized; the optional callback is read through a ref, preserving existing callers. Renderer failure still reports the visible error and disables the failed loop. One canvas is retained and the effect list remains bounded.

## Verification

- `apps/web/src/feel.test.ts`: velocity-following pose, reduced-motion pose, flap envelope, immutable bounded FX pool.
- `apps/web/test/newfeel.browser.ts`: actual canvas pixels change during flight; reduced-motion mode still renders and plays in the same single canvas.
- Existing renderer lifecycle test remains in place.
