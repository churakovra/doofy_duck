# Arcade simulation rules

This deterministic practice game runs independently in TypeScript and Go. `packages/game-sim/src/index.ts` and `services/core/simulation/simulation.go` are the executable specifications; `contracts/simulation/golden-v1.json` is the reviewed replay contract.

## Frozen current rules

- Units are integer milli-pixels. Each `step` advances one active 60 Hz tick; READY starts on its first FLAP. PAUSED and DEAD are inert.
- Rules identity is simulation `1.2.0`, gap generator `1.1.0`, default config ID `dd-v1-arcade-v2`; fixture revision is `foundation-arcade-2`.
- Default flight is gravity `320`, flap velocity `-5600`, terminal fall velocity `8500`, duck X `100000`, half extents `12000 × 10000`. A flap sets the impulse velocity, gravity is applied during that same tick, and velocity is capped before position integration.
- Default pipe speed ramps from `3000` to `5800` over `2700` active ticks. For one-based tick `t`, base speed is `speed + floor((maxSpeed-speed)*clamp(t-1,0,rampTicks)/rampTicks)`. Add `floor(speed * floor(score/speedEveryPipes) * speedStepPercent / 100)`, capped at `maxSpeed`; defaults add 10% of base speed per 10 scored pipes. A pipe scored this step affects speed starting the following step. Existing pipes and pickups move by the same speed.
- Default gap center range is `160000..400000`, gap height `156000`, and adjacent generated centers differ by at most `85000`. A raw center is selected independently per pipe using `mix32(seed XOR imul(index+1, 0x9e3779b9))`, then clamped to the configured range and previous center ± maximum delta. The first center is additionally clamped to ±35000 from the configured range midpoint. `lastGapCenter` is explicit run state so generation remains stable after horizon refill and pipe pruning. No currency outcome feeds back into map layout.
- Configured bonus definitions retain weighted NONE-first selection and eligibility/spacing rules. Default FEATHER uses weight 34, minimum pipe index 1 and one-pipe spacing; GAME_STAR uses weight 8, minimum index 4 and three-pipe spacing; NONE weight is 58. Pipe 0 follows the configured eligibility rules. A selected bonus shares its pipe X and receives a seeded, off-center Y constrained to the opening's safe inner region, including pickup radius and duck half-height.
- `PATTERN_CATALOG` / Go `PatternCatalog()` remain only as legacy exported constants for compatibility. They do not choose gaps or constrain valid gap geometry. Config identities retain these public legacy entries; default identity is the explicit `dd-v1-arcade-v2` sentinel, and custom identities include canonical configuration plus the legacy catalog.

## Bounds and parity

All new fields must be safe integers; gap limits must keep the entire configured opening within ceiling/floor; max gap delta and speed interval must be positive; ramp multiplication is bounded to JavaScript's exact integer range. Score passed to `worldSpeedAt(config,tick,score=0)` is a nonnegative safe simulation counter. Go's `WorldSpeedAt(config,tick,scores ...int64)` preserves old two-argument calls while accepting at most one optional score.

Generation uses independent indexed sampling, not mutable PRNG draws for map shape. Existing PRNG cursor behavior remains for spawn opportunities; every eligible pipe opportunity, including NONE and capacity suppression, advances it. Go fixture verification compares raw expected JSON, including state fields and event serialization.

## Verification and limits

The fixture producer retains 12 complete-state replay cases, 30 operations, 24200 accumulated advance ticks, 5 rejection cases and 4 mixer vectors. It includes a custom-physics bounded 24000-tick witness; this is not a default physics survivability claim. Default random gaps require active steering. Custom configurations are not promised universally reachable.

Run `npm run build:sim`, `npx vitest run packages/game-sim/test`, `npm run test:parity`, `npm run test:go:race`, and `go -C services/core/simulation vet ./...`. Regenerate fixtures only after reviewing a deliberate rule change: build the sim, then run `node contracts/simulation/generate-fixtures.mjs`.
