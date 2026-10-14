# Frozen speed-foundation simulation handoff

This is a standalone practice simulation, not a wallet or online authority. The internal ruleset is `simulationVersion: 1.1.0`; the pattern generator remains `generatorVersion: 1.0.0`. `golden-v1.json` revision `foundation-speed-1` records the complete TypeScript-produced fixtures and reviewed rules. This replaces the unreleased `foundation-2` fixed-speed fixture, not a published compatibility promise.

## Authoritative inputs

- `packages/game-sim/src/index.ts`: executable rule order and public TypeScript API, including `worldSpeedAt(config, tick)`.
- `golden-v1.json`: default configuration, authored patterns, rules, complete states/events, controller traces, speed-boundary cases, and rejected cases.
- `packages/game-sim/test/stabilization.test.ts`: independent speed assertions, multi-seed default runs, and closed-orbit witness.
- `packages/game-sim/test/fixtures.test.ts`: executable replay of every committed expected state/event and rejection case.
- `services/core/simulation/simulation.go`: independent Go rules implementation and raw-JSON fixture harness.

Fixture regeneration is manual: run `npm run build:sim && node contracts/simulation/generate-fixtures.mjs` after inspecting a deliberate rule change. Never regenerate fixtures automatically from a test. The producer asserts independently calculated speed displacements, default identity, and contact preconditions; it is not itself an independent oracle. TS semantic tests and the Go implementation provide additional verification.

## Exact speed and lifecycle semantics

- Units are integer milli-pixels; one `step` is one active 60 Hz simulation tick. For positive, one-based running tick `t`, `worldSpeedAt(config,t) = speed + floor((maxSpeed-speed) * min(max(t-1,0),rampTicks) / rampTicks)`. For `t <= 0`, the helper returns base speed. Defaults are `2400 -> 4800` over `5400` ramp ticks. Thus tick 1 is 2400, tick 2701 is 3600, tick 5400 is 4799, and tick 5401 onward is capped at 4800.
- READY does not advance simulation time. Its first successful running step uses tick 1 / base speed. PAUSED and DEAD steps are inert; pause/resume leaves the active tick unchanged; restart returns to tick 0 and initial speed.
- Every existing pipe and collectible moves by the same computed speed for that simulation tick. Pickups created during the step use their pipe's post-movement position and do not move again on their creation tick.
- `PipeConfig` includes positive safe-integer `maxSpeed` and `rampTicks`; `maxSpeed >= speed` and `width >= maxSpeed`. Config integer/range guards keep the multiplication exact and safe in both JavaScript and Go.
- Default config identity is `dd-v1-speed-v1`. Custom config identity remains `dd-v1-config:` plus canonical JSON of `{configuration, patterns}`. Simulation version is 1.1.0; generator version stays 1.0.0.

## Preserved simulation semantics

- Input sequence is contiguous; multiple valid frames in one step consume their sequence numbers but apply one flap impulse. Canonical objects recursively sort ASCII keys; arrays preserve order; safe integers only; empty maps/lists stay `{}`/`[]`.
- Seed is uint32. `mix32` is unsigned MurmurHash3 fmix32 with wraparound multiplications. Four-pipe pattern selection and cursor advancement are unchanged.
- Default safe lead-in is 420000; flight physics, collision boundaries, score behavior, pickup weighting, no-item handling, bounded live arrays, and lethal-tick ordering are unchanged.
- Pipe positions move first. Existing pickups move once; new pickups spawn aligned with their moved pipe. Death precedes score/pickup/generation. Event ordering follows stored pipe/item order.
- Unsupported custom configs are experiments, not covered by a universal feasibility guarantee. Local window coordinates do not accumulate world distance; bounded arrays are not a browser heap measurement.

## Fixture execution and coverage

There are 12 complete-state fixture cases, 30 operations, 24200 accumulated advance ticks, 5 invalid cases, and 4 mixer vectors. Fixtures include midpoint displacement with correlated pipe/pickup movement, pause/resume, the last pre-cap tick, capped movement, and the existing lifecycle/scoring/pickup/long-run edge cases. Every Go comparison parses the raw expected JSON and compares the actual serializer output, including required `{}` presence; it does not normalize through typed expected states.

## Reachability witness and limits

The default controller flaps on the first tick, then flaps whenever the previous `y >= 333000` and `vy > 0`. With the new ramp, first-pipe leading-edge contact occurs at tick 92 (cumulative travel 222620 milli-pixels; required travel is 222000). The established vertical orbit remains ticks 115–219, period 104, with `y` in 227440..335600. This lies strictly inside every authored gap's common safe center interval (222000,338000); the earlier prefix after first contact also remains inside it. Pipe geometry width 52000 exceeds capped travel 4800, avoiding skipped obstacle crossings.

Sixteen seeds survive exactly 24000 ticks in executable TS tests with bounded pipe and collectible arrays. The reviewed seed-3 producer trace reaches tick 24000 with score 493. These are one default-control witness and bounded test results, not proof every player can survive, a claim about custom-config feasibility, or a Playwright/mobile performance claim.
