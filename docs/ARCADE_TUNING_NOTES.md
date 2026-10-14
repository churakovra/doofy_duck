# Arcade tuning: research and implementation rationale

> Rationale recorded during the tuning/integration iteration. Pending or intended
> implementation statements below describe that checkpoint. Final mechanics are
> in [Arcade simulation](ARCADE_SIMULATION.md); subsequent checks are recorded in
> [Arcade fixes results](ARCADE_FIXES_RESULTS.md).

This is a tuning iteration, not a claim to have surpassed the original Flappy Bird. No original Flappy Bird proprietary code or assets were obtained. Earlier work added presentation effects while retaining slow, broad flight arcs; that was insufficient to meet the requested tactile change.

## Primary reference code inspected

Retrieved directly from the authors' public repositories during this iteration:

1. FlapPyBird player implementation: https://github.com/sourabhv/FlapPyBird/blob/master/src/entities/player.py
2. FlapPyBird pipe implementation: https://github.com/sourabhv/FlapPyBird/blob/master/src/entities/pipe.py
3. Clumsy Bird entity implementation: https://github.com/ellisonleao/clumsy-bird/blob/master/js/entities/entities.js

These are established recreations, not the original game's source. No third-party game artwork, sounds or code were copied into this project. Branch URLs are mutable references, not pinned historical claims.

FlapPyBird resets vertical velocity on flap, applies downward acceleration, bounds falling velocity, and couples player rotation/wing animation to flight. Its gap generation uses a constrained vertical region instead of the full height. Clumsy Bird emphasizes a short upward response, explicit angle changes and immediate flap audio. Its tween-based implementation is not being substituted for this project's deterministic collision physics. Neither reference establishes our chosen difficulty or fun automatically.

## Physics change being integrated

At60Hz, applying the project's actual semi-implicit update to a single flap gives:

| Metric | Previous physics | Arcade tuning |
| --- | --- | --- |
| Gravity, milli-pixels/tick² |80|320|
| Flap velocity, milli-pixels/tick |-4200|-5600|
| Lift before apex |108.16px|46.24px|
| Time to apex |0.867s|0.283s|
| Time back to starting height |1.733s|0.567s|

These metrics were calculated by executing the exact discrete velocity-then-position recurrence, not by assuming a continuous parabola. This should make input tighter and require a quicker tap rhythm; owner playtesting is still necessary to judge whether the result is enjoyable.

## Presentation change

- An accepted flap immediately pulls the pose toward an upward angle, including before a falling velocity updates on the next physics tick.
- The wing is a separate, visibly articulated shape rather than a small moving copy over a static wing.
- A180ms impulse envelope replaces the340ms response; the body stretches16% vertically and narrows10% at the pulse peak.
- Each flap emits a small bounded three-streak air burst; air travels behind the duck rather than simply floating upward.
- Diving rotation is more legible. Extra effects remain limited to the existing20-item pool and disabled with reduced motion. No extra gameplay RNG, physical recoil, screen shake or hitbox expansion is introduced by the renderer.

Focused presentation tests were observed failing on the old pose/envelope, then passed after implementation. Final combined integration results must be checked after the simulation change lands.

## Generation and difficulty direction

The simulation work replaces the repeating near-centre catalog with a seeded bounded-height random walk; adjacent gap changes are limited to avoid arbitrary full-screen jumps. Pickups use varied off-centre heights constrained by both the pipe opening and the inner70% of the vertical playfield. This interprets the requested active60–80% region as a central70% height band, not a70% spawn probability.

Faster initial motion and a shorter active-time ramp are combined with a10%-of-base-speed increment every10 passed pipes, subject to a safe speed cap. Scores and currency do not secretly alter map RNG; the intended score-based speed change is explicit. Exact defaults and TS/Go evidence are recorded in ARCADE_SIMULATION.md by the simulation implementation.

## Development regression coverage

The previous start-button bug occurred only under React's development StrictMode. `npm run test:dev` now runs start/reload checks against the actual Vite development app, rather than assuming that production-preview tests cover double-effect cleanup. Native wallet-lock release must complete before its replacement request starts; this is separate from a genuinely competing tab, which remains protected.

## Still requires human evaluation

Challenge pacing, sensation of impact, bonus-route appeal and musical taste require an owner playtest. Bounded generation and surviving-controller tests are useful evidence, not a proof that every custom configuration or every possible generated route is optimal. Physical Telegram/mobile audio, touch comfort and named-device performance remain separate gates.
