# Speed ruleset update

> Historical: superseded by simulation 1.2.0. See [ARCADE_SIMULATION.md](ARCADE_SIMULATION.md) for current speed and config identity.

- Simulation version: `1.1.0`; generator version remains `1.0.0`.
- Default identity: `dd-v1-speed-v1`. Custom identity remains the exact canonical configuration+pattern identity.
- `PipeConfig` adds `maxSpeed: 4800` and `rampTicks: 5400` (defaults); base `speed` remains 2400. A valid config requires positive safe-integer ramp ticks, max speed at least base speed, and pipe width at least max speed. Existing bounded integer config validation keeps `(maxSpeed-speed)*elapsed` exact/safe in JS and Go.
- `worldSpeedAt(config,tick)` is exported by name in both implementations. For positive, one-based active ticks, the result is `speed + floor((maxSpeed-speed)*min(max(tick-1,0),rampTicks)/rampTicks)`. A nonpositive tick returns base speed. Defaults: tick 1 = 2400, tick 2701 = 3600, tick 5400 = 4799, tick 5401+ = 4800.
- READY's first running tick uses base speed. PAUSED does not advance the tick. Restart resets to tick 0. All existing pipes and collectibles share one computed tick displacement; newly spawned pickups remain aligned with the pipe after movement.
- Flight physics, scoring, generator rules, pickup weights, terminal behavior, and purchase/economy behavior are unchanged.

## Verification snapshot

`contracts/simulation/golden-v1.json` is reviewed revision `foundation-speed-1`: 12 full-state/event cases, 30 operations, 24200 accumulated advance ticks, 5 rejected cases, and 4 mixer vectors. It covers midpoint, pre-cap/cap, synchronized entity movement, pause/resume, and preserved foundation edge cases. Fixture generation remains explicit via `npm run build:sim && node contracts/simulation/generate-fixtures.mjs`; it is never an automatic test action. Go parity compares actual serialized JSON against raw expected fixture messages, preserving required empty-object fields.

The default control witness contacts the first pipe at tick 92 after 222620 milli-pixels of cumulative travel (222000 required); its period-104 vertical orbit remains within the common authored gap-safe center interval. Sixteen TS seeds survive exactly 24000 ticks; reviewed seed 3 reaches that horizon with score 493. This does not claim universal player or custom-config feasibility.
