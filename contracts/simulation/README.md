# Frozen foundation-2 simulation handoff

This is a standalone practice simulation, not a wallet or online authority. The 1.0.0 labels describe the target unreleased rules. Earlier agent fixtures were obsolete and never a released compatibility contract. `golden-v1.json` revision `foundation-2` replaces them after observed behavioral regression fixes.

## Authoritative inputs

- `packages/game-sim/src/index.ts`: complete executable rule order and public TypeScript API.
- `golden-v1.json`: default configuration, authored patterns, rules, complete states/events, scripted input schedules and rejected cases.
- `packages/game-sim/test/stabilization.test.ts`: independent semantic regression assertions, multi-seed default runs and closed-orbit witness.
- `packages/game-sim/test/fixtures.test.ts`: executable replay of every committed expected state/event and rejection case.

Do not change shared rules/fixtures during the Go implementation. Report mismatches to the parent. Fixture regeneration is manual via `node contracts/simulation/generate-fixtures.mjs` after building the simulation and reviewing the intended changes; it is not an automatic passing-test step. The producer makes concrete semantic assertions but is not an independent oracle; the separate semantic tests and independent Go implementation provide additional checks.

## Important exact semantics

- Gameplay is integer milli-pixels, one call to step per fixed60Hz tick. An input has sequence and action; its tick is the step invocation that contains it. Multiple valid frames in a step consume all contiguous sequence numbers but apply one upward impulse.
- Supported simulationVersion and generatorVersion are both `1.0.0`. Default configId is `dd-v1-default` only when full config content matches DEFAULT_CONFIG. Custom configId is `dd-v1-config:` plus canonical JSON of `{configuration: config, patterns: PATTERN_CATALOG}`. This verbose local identity avoids hash collisions; it is not authorization or a production remote-config protocol.
- Canonical objects recursively sort ASCII keys. Arrays retain order. Integers serialize without fractions. Empty maps are `{}` and empty lists are `[]`, never null. Every returned state field is present. Input config is carried in the state. A no-op DEAD/PAUSED step has no events.
- Seed is uint32. `mix32` is unsigned MurmurHash3 fmix32, using wraparound multiplications. Per four-pipe block select catalog index by `mix32(uint32(seed XOR imul(floor(pipeIndex/4)+1,0x9e3779b9))) % catalogLength`. Within the block use pipeIndex modulo4. Cursor still advances by uint32(0x9e3779b9) for every generated pipe and for every evaluated index>=2 pickup opportunity, including NONE/capacity-suppressed opportunities.
- The safe opening is now420000; earlier240000 tuning caused the initial forced flap to fail some seeds. Other default physics remain unchanged. Default horizon yields three initial pipes.
- Each eligible pipe gets one pickup-table evaluation. Filter definitions by minimum index/global spacing; NONE is first cumulative bucket. No eligible weights means NONE while consuming the opportunity. A wholly zero configured table is invalid. Capacity suppresses the result without retrying. Minimum spacing is global across item types in this simple version.
- Pipe positions move first. New pickups spawn at their pipe's post-movement position and do not move again on their creation tick. Existing pickups move once. Stable IDs, nextSpawnPipeIndex and cursor state prevent rerolls/recreation.
- Death is checked before new score/pickups/generation and is terminal. Score boundary is strictly pipe.right < duck.left; contact equality is lethal for AABBs. Event array ordering is runtime stored pipe/item order, not lexicographic ID sorting.
- Live coordinates are window-relative; they do not accumulate world distance. Discarded objects and input prefixes are not retained. Explicit safe-integer checks protect lifetime counters; tested bounded live arrays are not proof of browser heap behavior.

## Fixture execution

Each case supplies full `initialState` and operations. For non-synthetic cases, first call createRun(initialState.descriptor, initialState.config) and compare the complete initial state. Synthetic cases supply edge-test states directly.

Operations:
- step: call step(state, frames), compare full state and events.
- pause/resume/restart: call matching function; expect no external events and compare full state. Restart uses supplied descriptor and current config.
- advance: repeat step for `ticks` iterations. `flapTicks` are one-based positions within this operation. Each flap uses the current state's nextInputSequence. Aggregate every emitted event in order. Compare full final state and full aggregated events. DEAD steps remain no-ops even if advance has remaining iterations.

All invalidCases must reject; the exact human-readable exception string is not a cross-language contract. Supported practice configs may differ from defaults but do not inherit a universal feasibility guarantee.

## Reachability evidence and limits

The controller first flaps, then flaps when prior y>=333000 and vy>0. Actual default physics enters a closed vertical orbit between ticks115 and219 (period104); orbit y lies in227440..335600, strictly inside the common safe interval222000..338000 for every authored gap. First pipe contact is tick93; the prefix from that contact to the closed orbit is also inside the interval. Because later pipe order does not affect vertical physics, this supplies one safe strategy across every default catalog transition. It does not say every player state is recoverable or every custom config is feasible.

Sixteen seeds each survive exactly24000ticks in executable tests. The committed seed3 long-run fixture scores261 at tick24000. No Playwright/mobile performance claim or human/bot discrimination follows from this witness.
