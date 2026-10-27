# Arcade simulation rules

The deterministic game runs independently in TypeScript and Go. The modules exported by `packages/game-sim/src/index.ts` and the native `services/core/simulation` package are the executable specifications. Existing committed replay fixtures remain frozen. See the [code map](ARCHITECTURE.md) for module ownership.

## Wetland rules

The current varied-base default is simulation/generator `3.1.0`,
configuration `dd-v3-varied-base-v1`, encounter catalog 12. Core issues this
identity for new runs. Ordinary pipes use fixed 126,400-unit center spacing.
Their gap centers move a seeded 30,000–70,000 units in either direction from
the previous center. If a move crosses a configured center bound, it reverses;
the initial gap retains the prior safe bound of ±35,000 from the configured
range midpoint. Catalog 11's bonus schedule, bonus gate spacing and coin
figure placement are unchanged. A seeded hard bonus
pattern first appears at block 6, 7 or 8 (pipes 24, 28 or
32), then repeats every seven blocks. It uses one of three recipes—shallow
ascent, descent or slalom—with seeded mirroring, yielding four realized shapes.
The first two bonus gates are spaced 66,880 units apart, followed by 268,000
units to a three-FEATHER figure reward in the pipe-free interval after gate
three. Base spacing resumes afterward. Normal FEATHER pickups and the existing
Star schedule remain enabled. Catalog 11 remains separately resolvable for
issued runs at `3.0.0` / `dd-v3-base-bonus-v1`.

Catalog 11 uses simulation/generator `3.0.0`, configuration
`dd-v3-base-bonus-v1`, encounter catalog 11. Its spacing and seeded ±45,000-unit
gap-center walk remain frozen for issued runs.

Catalog 10 uses simulation/generator `2.9.0`,
configuration `dd-v2-dense-pipes-v1`, encounter catalog 10. Core issues this
identity for its issued runs. It retains catalog 9's intro, recovery and bonus-segment
behavior. Ordinary pressure pipes alternate seeded gap-center moves of 60–80
pixels; when a move would cross a configured gap-center bound, it reflects in
the opposite direction. Move magnitude is capped by the configured maximum
gap delta. Dense pipes scales authored edge clearance to 60% on every station,
including ordinary, bonus-segment and recovery stations. Its default supports
18 active pipes and schedules a Star exactly every 16 pipes. Catalog 9 remains
separately resolvable for issued runs at `2.8.0` / `dd-v2-pressure-pipes-v1`.
Catalog 8 remains separately resolvable for issued runs at
`2.7.0` / `dd-v2-varied-pipes-v1`. Catalog 7 remains separately resolvable for issued runs at
`2.6.0` / `dd-v2-bonus-segments-v2`. Catalog 6 remains separately resolvable for issued runs
at `2.5.0` / `dd-v2-bonus-segments-v1`. Coin-course rules remain separately
resolvable for issued runs at `2.4.0` / `dd-v2-coin-course-v1`, catalog 5;
currency formations remain
separately resolvable at `2.3.0` / `dd-v2-currency-formations-v1`, catalog 4.
The prior paired-route rules remain frozen at simulation/generator `2.2.0`, configuration
`dd-v2-paired-routes-v1`, encounter catalog 3. Existing runs retain their issued
identity, including frozen `2.1.0` / `2.1.0` / `dd-v2-varied-obstacles-v1`,
`2.0.0` / `2.0.0` / `dd-v2-wetland-v1` and earlier rules. See
[wetland challenges](WETLAND_CHALLENGES.md) for current verification status.

Catalog 3 generates paired pipes at every station. It uses the catalog-1 authored
gap centers and paired pickup resolver, the 156-pixel opening and varied
240/300/360-pixel spacing. It omits catalog-2 edge-lane and variable obstacle
geometry. Its scored stations retain their silhouettes until offscreen, as in
catalog 2. Mixed obstacle generation remains supported under its frozen identities
for existing flights and future development.

Catalog 4 keeps the paired obstacle geometry and schedules deterministic reward
formations. Each eligible coin route contains three individual FEATHER pickups;
each scheduled Star route contains five individual GAME_STAR pickups laid out
as a star. Every member has its own stable ID, amount 1, normal collision test
and `CurrencyCollected` event. Group value is the number of members. Seeded
orientation and inside/outside pipe placement vary between routes. The runtime
capacity is 29 active individual pickups, covering eight active stations with
three coins each plus one five-member Star formation. Wallet payout and the
30-FEATHER run cap are unchanged.

Catalog 5 retains catalog-4 formations and adds occasional required coin-course
blocks selected deterministically by seed and block. Each course has three
paired gates at 180-pixel spacing, then a 360-pixel recovery gap; its third gate
station carries a three-member FEATHER formation. Ordinary trails are suppressed
within that course block, while normal coin formations continue elsewhere.
Courses use the shared deterministic integer simulation, existing collision
rectangles and per-coin collection path: only touched coins pay. Death and
scoring rules are unchanged. The independent Star schedule, placement, rewards
and physics are unchanged.

Catalog 6 (simulation/generator `2.5.0`, config
`dd-v2-bonus-segments-v1`) schedules occasional seeded bonus segments: within each three-block
slot starting at block 2, the seed selects one of its first two blocks. Each
segment uses one of three three-gate patterns: shallow ascent, shallow descent
or shallow slalom. Normal station spacing retains 70% of the authored
edge-to-edge pipe margin; the hard three-gate segment retains 20%. These
percentages apply to the clear margin after subtracting pipe width, not to
center-to-center spacing.
The three compact gates are followed by a recovery interval with 360 pixels of
clearance. A three-coin figure reward sits in the pipe-free interval after the
third gate. Regular coin and Star pickups remain single pickups. Star formations
are disabled in the default config and can be enabled by config opt-in; the
seeded Star schedule remains active at 12–16 pipes. Existing catalog-4 currency
formations and catalog-5 coin courses keep their own identities and rules for
issued runs.

Catalog 7 keeps the catalog-6 occasional seeded segment schedule, recovery and
three-coin figure reward, while tightening spacing: ordinary stations retain
50% of authored edge-to-edge pipe margin and hard three-gate segments retain
10%. As in catalog 6, the percentage applies to clear space after subtracting
pipe width. Relative to the seeded anchor, gate-center offsets are ascent
`[0, -40, -80]`, descent `[0, 40, 80]`, or slalom `[0, 40, -40]` pixels;
seed mirroring flips their signs. These routes span 80 pixels. Outside
scheduled segments, gap centers after the two introductory blocks wander
deterministically within 45 pixels of the previous center, clipped to the
configured gap-center bounds. Configured maximum gap delta also bounds each

Catalog 8 retains catalog 7's segment schedule, rewards, spacing and Star
behavior. Outside scheduled segments and the introductory blocks, seeded gap
centers may vary by up to 75 pixels on pressure steps and 35 pixels on steady
recovery steps. Each step is clipped to configured gap-center bounds and the
configured maximum gap delta.

The catalog-7 default Star schedule is every 14–16 pipes. Star formations remain
off by default and require config opt-in; ordinary Star and FEATHER rewards are single
pickups. Catalog 6 and earlier versions retain their issued identities and
behavior.

Frozen catalogs 1 and 2 combine paired pipes, ceiling vines, floor rocks/reeds and
floating debris in four-station encounters. Each station supplies authoritative collision rectangles,
encounter metadata and authored horizontal spacing. The existing `pipes` array
remains the station container for compatibility. Clear a station once to emit
`ObstaclePassed` and gain one point; paired pipes count once. Death takes priority
over scoring and collection on the same tick.

The first two families introduce obstacles. Starting at index 8, pressure and
recovery alternate. Seeded pressure selection does not repeat across consecutive
pressure encounters. Geometry and spacing belong to the same catalog; the initial
spacing choices are 240, 300 and 360 pixels, with 360-pixel recovery spacing.
Flight physics and the speed formula below remain unchanged.

Catalog 2 generates ceiling halves spanning 70–88% and floor halves spanning
70–90% of playable height. Floating debris is 90–216 pixels wide and 42 pixels
thick, with a seeded vertical center. The shared half-height minimum must be
70–88%; the configured maximum may reach 90%, with ceiling halves capped at 88%.
Collision and scoring use the realized
integer rectangles, including each floating bar's actual width. A scored station
remains in state until its complete silhouette has scrolled offscreen. The
156-pixel paired opening, physics and speed progression remain unchanged.

Introductory paired openings establish the seeded high or low approach; pressure
encounters keep their attached halves on that side. Recovery openings connect
toward the next pressure lane. Authored catalog-2 openings bypass the legacy gap
clamp, so the introduction and recovery retain their intended shape. Catalog 1
retains its frozen generation, reward placement and pruning behavior.

Coin routes offer two pickups in the initial/recovery families and four in the
second introductory/pressure families. Stars use the independent seeded 8–16
station schedule and optional harder routes. Pickups retain stable IDs and the
`CurrencyCollected` event. Replay and generation never depend on collected totals.

Old rulesets retain their original geometry, pickup behavior, event names and
serialized state. New wetland fields are omitted from their states.

## Prior pipe-only rules and shared physics

- Units are integer milli-pixels. Each `step` advances one active 60 Hz tick; READY starts on its first FLAP. PAUSED and DEAD are inert.
- Prior identity is simulation `1.4.0`, generator `1.3.0`, config ID `dd-v1-star-interval-v1`. Both it and the earlier `1.3.0`/`1.2.0` rules with `dd-v1-stepped-v1` remain supported for existing runs; `golden-v1.json` remains the earlier frozen replay contract. The remaining pipe-generation details in this section describe those prior rules.
- Default flight is gravity `320`, flap velocity `-5600`, terminal fall velocity `8500`, duck X `100000`, half extents `12000 × 10000`. A flap sets the impulse velocity, gravity is applied during that same tick, and velocity is capped before position integration.
- Default pipe speed ramps from `3000` to `4800` over `2700` active ticks. For one-based tick `t`, base speed is `speed + floor((maxSpeed-speed)*clamp(t-1,0,rampTicks)/rampTicks)`. Add `floor(speed * floor(score/speedEveryPipes) * speedStepPercent / 100)`, capped at `maxSpeed`; defaults add 10% of initial speed per 10 scored pipes. A pipe scored this step affects speed starting the following step. Existing pipes and pickups move by the same speed. This speed ramp is separate from the stepped challenge schedule.
- Default gap center range is `160000..400000`, gap height `156000`, spacing `300000`, and adjacent generated centers differ by at most `85000`. Default generation uses the challenge families below. Custom configs with absent or `null` challenges retain indexed gap sampling using `mix32(seed XOR imul(index+1, 0x9e3779b9))`, clamped to the configured range and previous center ± maximum delta. The first center is additionally bounded to ±35000 from the configured range midpoint. `lastGapCenter` is explicit run state so generation remains stable after horizon refill and pipe pruning. No currency outcome feeds back into map layout.
- Ordinary collectible definitions retain weighted NONE-first selection and eligibility/spacing rules. Prior 1.4 default FEATHER uses weight 34, minimum pipe index 1 and one-pipe spacing; NONE weight is 66, preserving the prior 34% ordinary-pickup probability. The legacy configuration keeps the former weighted GAME_STAR opportunity (weight 8, minimum index 4, three-pipe spacing) and NONE weight 58. Ordinary collectible opportunities advance the same indexed RNG cursor in both rulesets.
- Prior 1.4 default GAME_STAR pickups use an independent seeded schedule. The first target pipe index is 8–16, and each later target is another 8–16 pipe indices after it, inclusive. The schedule is stored in run state, so pauses, restarts and replay remain deterministic; it does not consume the ordinary collectible RNG or change the ordinary collectible cooldown. A scheduled Star is generated when two ordinary collectibles are active. The default holds up to two ordinary collectibles plus one Star, and validates that the minimum schedule interval moves the previous Star beyond the active viewport before the next can appear. A Star credits exactly one only when the duck intersects it.
- `PATTERN_CATALOG` / Go `PatternCatalog()` remain only as legacy exported constants for compatibility. They do not choose gaps or constrain valid gap geometry. Config identities retain these public legacy entries; the two pipe-only default identity sentinels are `dd-v1-star-interval-v1` and `dd-v1-stepped-v1`, and custom identities include canonical configuration plus the legacy catalog.

## Stepped challenge schedule

`GameConfig.challenges` contains immutable family IDs, bands and ordered gap
centers. The prior pipe-only catalog defines steady, rising, falling and offset routes.
Each family has four pipes, with `challengeId` and zero-based `challengeStep` on
generated pipes. The renderer uses their gap geometry directly.

For zero-based pipe index `i`, family block is `floor(i / 4)`:

- Block 0 (pipes 0–3) is the intro family.
- Blocks 1–2 (pipes 4–11) use two seeded cruise families.
- Block 3 onward alternates seeded pressure and steady recovery families. Pressure
  is the difficulty cap; recovery provides breathing room without resetting it.

Selection depends on seed and block index, independent of the collectible RNG.
Initial horizon generation and later refill use the same schedule; pausing does
not expose new pipes, and restarting resets encounter progress. Progression is
measured in pipes, not predicted wall-clock encounter times. There is no promise
that a band begins at exactly 15 or 30 seconds.

The challenge set is copied into each run and included in its configuration
identity. Omitted and `null` challenges normalize to the same gap-only identity.
Catalog validation rejects invalid geometry, references, intro lead-in and
incompatible selectable family boundaries before play starts. Thus validated
challenge centers retain their authored shape; the bounds clamp still protects
the gap-only path. The legacy catalog above does not select these new families.

Descriptor validation accepts the wetland catalog-3 through catalog-8, prior,
and legacy simulation/generator versions. Each default config ID is bound to its matching version pair; custom
configuration IDs carry canonical configuration content. A legacy descriptor
without an explicit config resolves to the legacy default, whose serialized state
omits Star schedule fields so replay remains unchanged.

## Bounds and parity

All new fields must be safe integers; gap limits must keep the entire configured opening within ceiling/floor; max gap delta and speed interval must be positive; ramp multiplication is bounded to JavaScript's exact integer range. Score passed to `worldSpeedAt(config,tick,score=0)` is a nonnegative safe simulation counter. Go's `WorldSpeedAt(config,tick,scores ...int64)` preserves old two-argument calls while accepting at most one optional score.

Generation uses independent indexed sampling, not mutable PRNG draws for map shape. Existing PRNG cursor behavior remains for spawn opportunities; every eligible pipe opportunity, including NONE and capacity suppression, advances it. Go fixture verification compares raw expected JSON, including state fields and event serialization.

## Verification and limits

The frozen legacy fixture producer retains 13 complete-state replay cases, 40 operations, 29200
accumulated advance ticks, 5 rejection cases and 4 mixer vectors. Its legacy
gap-only custom-physics 24000-tick witness retains the previous speed/spacing; it
is not default-world evidence. A separate 5000-tick prior-default trace records ten
snapshots across all bands and refill, with controls based on observed gaps.

Both languages also test all 26 selectable family edges from nine sampled entry
states per edge and a 64-seed, 5000-tick prior-default corpus. The direct witnesses keep
the previous lane target for 18 ticks after the new pipe center reaches X360000
before adapting. This is bounded controller-specific evidence; the sampled
entry envelope is not closed under all composed exit states and does not prove a
universal human reaction window. Owner playtests, final tuning and real-device
acceptance remain open. Arbitrary custom configurations have no universal
reachability guarantee.

The separate `contracts/simulation/star-schedule-v1.json` holds authored Star
schedule vectors shared by TypeScript and Go. It supplements the frozen legacy
golden file and does not replace or regenerate those expectations.

Run `npm run build:sim`, `npx vitest run packages/game-sim/test`, `npm run test:parity`, `npm run test:go:race`, and `go -C services/core/simulation vet ./...`. Regenerate fixtures only after reviewing a deliberate rule change: build the sim, then run `node contracts/simulation/generate-fixtures.mjs`.
