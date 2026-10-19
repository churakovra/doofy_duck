# Wetland challenges

Status: current new runs use catalog-4 currency formations. Simulation/generator
`2.3.0` use configuration `dd-v2-currency-formations-v1`; catalog-3 paired
routes remain frozen at `2.2.0` / `dd-v2-paired-routes-v1`. Both use paired-pipe
gameplay, varied spacing and authored coin/Star routes. Local gameplay
acceptance remains open.

The mixed obstacle implementations remain in the codebase under their frozen
`2.1.0` and `2.0.0` identities. Existing flights retain their issued rules. The
catalog-2 controller investigation is deferred: its declared 27-case maximum-speed
matrix passed 26 cells and failed seed 9, entry Y 275000, velocity +500 at tick
4656. A local counterfactual passed that obstacle and its following exit, but did
not establish a general controller repair or complete matrix acceptance. These
experiments are retained for future work and do not certify mixed gameplay.
Resume that work from `VARIED_OBSTACLE_DEFAULT_CONFIG` / Go
`VariedObstacleConfiguration()` and its frozen fixtures. Enable
`RUN_MIXED_OBSTACLE_EXPERIMENTS=1` to reproduce the deferred controller cases;
resolve the recorded matrix and reward-route gaps before returning mixed
obstacles to new-run issuance.

## Paired-route target

The frozen catalog-3 paired identity remains replayable for existing runs.
New-run behavior is described below under currency formations.

Catalog 3 restores all four stations in every family to paired pipes. It retains
the original wetland authored gap centers, the 156-pixel opening and
240/300/360-pixel spacing. Recovery uses 360 pixels. The first two families lead
into seeded pressure/recovery alternation without immediate pressure-family
repetition. Each pipe pair scores once and stays visible until its complete
silhouette scrolls offscreen.

Coin opportunities retain two pickups on initial/recovery routes and four on
quick-pair/pressure routes. Authored lateral and vertical offsets provide the
optional routes; scheduled Stars retain their independent 8–16-station interval.
The paired catalog-3 default authors its Star route at a 35-pixel vertical offset;
frozen catalog-1 and catalog-2 defaults retain their 70-pixel authored offset.
The new default uses the paired reward resolver rather than catalog-2 edge-lane
geometry. Generation, collision, scoring and collection remain shared integer
TypeScript/Go rules. Collecting or ignoring rewards cannot change later geometry.

Previously issued paired runs use policy
`verified-pickups-v5-paired-routes`, which accepts only
`2.2.0` / `2.2.0` / `dd-v2-paired-routes-v1`, retaining the 30-coin run cap, 1:1
credit and existing Star rules. All older supported policies remain eligible.
The catalog-3 paired fixtures remain byte-frozen.

## Currency formations

Catalog 4 keeps paired pipes and spacing while creating groups of three
individual FEATHER members on eligible coin routes and five individual
GAME_STAR members on each scheduled Star route. Each member has amount 1, a
stable deterministic ID and the existing collision/event path. Group value is
the member count. Seeded layouts vary sides and place coin members inside or
outside pipe routes. The 29-member active capacity covers the maximum of eight
active stations with three coin members each plus one five-member Star group.
The settlement cap and per-member payout semantics remain unchanged. The new
`currency-formations-v1.json` fixture supplements all frozen fixture bytes.

Required current evidence is paired geometry and varied spacing, complete unique
reward opportunities and Star capacity, fatal-tick ordering, once-only scoring,
offscreen retention, deterministic lifecycle/refill, old-rule compatibility,
shared raw JSON parity, bounded paired survival/reward witnesses, and real
PostgreSQL settlement/deduplication/cap checks. Bounded controller witnesses do
not prove universal reachability or human gameplay acceptance. Browser suites,
visual playtesting and physical Telegram/mobile checks remain separate.

## Retained catalog-2 geometry

The retained geometry uses simulation/generator `2.1.0`, configuration
`dd-v2-varied-obstacles-v1` and encounter catalog version 2.

- Scored stations remain visible until their collision bodies and decorative
  silhouettes have scrolled offscreen. Passing still scores once.
- Ceiling halves span a seeded 70–88% of playable height; floor halves span
  70–90%. The ceiling cap preserves the existing flight physics: a full-width
  90% ceiling half cannot be crossed at starting speed.
  Custom catalog-2 half-height minima must not exceed the ceiling cap of 88%;
  floor halves can still use a configured maximum of 90%.
- Floating horizontal obstacles vary from 90 to 216 pixels wide, retain a
  42-pixel thickness and vary their vertical position.
- Simulation rectangles govern collision, scoring, reward placement and rendering.
  Authored connectors establish high/low approaches before long barriers.
- Existing `2.0.0` and older identities, serialized states and fixture expectations
  remain frozen. At the catalog-2 milestone, issuance changed only after replay, frontend and
  settlement support were integrated.

Catalog 2 starts with paired openings approaching one seeded edge lane. The low
route uses centers 280/340/400/483 pixels; the high route mirrors them to
281/221/161/78. Quick pairs retain the selected approach. Pressure encounters
choose a seeded high or low lane; their attached halves use the matching floor
or ceiling orientation. Recovery uses paired openings at 360-pixel spacing.
When the next pressure lane changes, recovery connects through
100/220/340/460 pixels downward or 430/310/190/78 upward. Custom worlds translate
these recipes from their configured minimum gap center and validate their bounds.

Reward positions are resolved alongside the realized rectangles. Coin routes
use the free side of attached obstacles or an offset above/below floating debris;
paired openings retain authored lateral offsets. Stars use an approach detour
before the station. Pickup radius, duck clearance and world bounds constrain the
resolved points. Geometry clearance alone does not establish a playable reward
route: complete pickup and following-exit witnesses remain required.

Shared simulation support is committed in `6068641`. Type checking, lint,
154 simulation tests, native Go tests and shared parity passed for that milestone.
Independent review found custom-version binding and translated-recovery defects;
both were fixed and rechecked. Account integration also passed type/lint checks, 65 focused web tests, Core
PostgreSQL tests, and Platform formatting/lint/mypy plus 66 tests with real
PostgreSQL. Independent integration review found no blocker. At that milestone new runs used
catalog 2; policy `verified-pickups-v4-varied-obstacles` accepts only its exact
default identity, retaining 1:1 credit, the 30-coin run cap and existing Star
rules. The full catalog-2 route matrix and final checks remain open, so these
results do not mark the feature complete.

The witness harness gate passes four fixed cases: the accepted complete pressure
trail and following station, a varied-entry cap-speed transition, a genuine
READY/default/ramp run through the first recovery, and a 216-pixel floating bar
with its following pipe. The harness uses matured snapshots, checks the full
18-tick reaction delay and actual speed, and keeps reward and survival objectives
separate. Type checking, lint and all 160 simulation tests passed for this gate.
The full entry, boundary and reward matrix remains open.
Earlier searched reward examples were invalidated by a hidden-owner-metadata
issue in the test controller; their execution does not establish the required
observation contract. Corrected cases must use only observations matured after
18 ticks, collect the complete opportunity and pass the following station.

The approved finish target excludes browser suites, visual playtesting and
physical Telegram/mobile acceptance. Technical checks do not imply human
playability or hosted acceptance.

## Frozen 2.0.0 gameplay contract

The wetland rules use simulation `2.0.0`, generator `2.0.0` and default configuration
`dd-v2-wetland-v1`. Flight controls, gravity, flap impulse, duck hitbox and the
existing speed ramp remain unchanged. Coins retain the `FEATHER` identifier and
in-game Stars retain `GAME_STAR`; neither is Telegram Stars (XTR).

Each encounter contains four obstacle stations. Paired pipes have two collision
rectangles, hanging vines extend from the ceiling, rocks/reeds extend from the
floor, and floating debris leaves passages above and below. Clear one station to
earn one point, including when the station contains two pipe rectangles.
Collision on a tick suppresses both scoring and pickup credit on that tick.

The first two encounters introduce obstacle types and timing. Starting at station
index 8, demanding encounters alternate with recovery. Pressure choices depend on
the run seed and cannot repeat across consecutive pressure encounters. Encounter
geometry and horizontal spacing are authored together; 240, 300 and 360 pixels
are the initial spacing choices. Recovery uses 360 pixels. Pipe openings retain
their 156-pixel height.

Each four-station encounter offers a coin route: two individual coins during the
intro/recovery and four during the second introductory/pressure encounters.
Demanding routes require an optional detour from the easiest survival line.
Stars retain an independent seeded interval of 8–16 stations and are placed on
harder routes with an achievable exit. Each pickup is worth one and has a stable
ID. Generation reserves capacity for complete routes and Stars; collection choices
never change subsequent obstacle geometry.

The catalog authors horizontal and vertical offsets for coin routes. Stars use a
100-pixel horizontal offset after their station and a 70-pixel vertical offset,
bounded to the opening or a safe debris passage. The renderer uses the resulting
authoritative positions. The initial steady family's last debris center is 250
pixels; this tunes its rock-to-debris reward transition without changing physics.

## Authority and compatibility

TypeScript and Go independently implement the same integer simulation. Obstacle
rectangles, routes, spacing, scoring and pickup rules belong to the simulation;
Pixi draws state without choosing geometry or consuming gameplay randomness.
Cosmetics and reduced-motion preferences do not change collision or rewards.

Runs pin their rules at issuance. Existing simulation `1.4.0` / generator `1.3.0`
(`dd-v1-star-interval-v1`) and simulation `1.3.0` / generator `1.2.0`
(`dd-v1-stepped-v1`) remain replayable. Their serialized states omit wetland
fields, and existing committed fixtures remain unchanged. Wetland fixtures are
separate reviewed expectations shared by both implementations.

Economy policy `verified-pickups-v3-wetland` accepts the frozen `2.0.0` identity.
Verified coins credit at 1:1 up to the existing 30-coin cap per run; Stars retain
1:1 credit without a new cap. More available coins increase opportunities to reach
the cap rather than changing shop prices or the database cap constraint.

Deploy replay support, Economy eligibility and a compatible frontend before
enabling wetland issuance. Keep support for old identities while existing runs,
checkpoints and completion deliveries remain outstanding. Rolling issuance back
must not remove the ability to finish already issued wetland runs.

## Verification and acceptance

Required automated coverage includes deterministic refill and lifecycle behavior,
collision boundaries, once-only scoring, unique complete coin routes, Star
capacity, fatal-tick ordering, raw JSON parity and old-rules compatibility.
Controller evidence must cover selectable encounter transitions with an 18-tick
reaction delay and varied entry positions/velocities, both skipping and collecting
reward routes, plus composed seeded traces at maximum speed.

Settlement verification uses dedicated PostgreSQL test databases and covers the
new identity, duplicate delivery, the coin cap and prior policies. Routine Node/Go
checks, race/vet and affected backend checks are required. Browser suites remain
opt-in.

### Historical catalog-1 evidence

The following results describe the completed `2.0.0` baseline. They are not
current acceptance evidence for catalog 2 or the dirty feature branch.

- `npm run check`: passed types, lint, all 380 tests in 40 files, Go tests and the
  production build. The build retains a non-fatal large-chunk warning.
- `npm run test:parity`: passed 43 TypeScript fixture/wetland tests and the native
  simulation suite. The command now includes wetland replay and validation cases.
- Native simulation race/vet: passed. Core tests against the dedicated PostgreSQL
  test database, Core race checks and vet: passed. The optional live Platform
  development-token interoperability test was skipped because its external
  endpoint/key environment was not configured.
- Python PostgreSQL suite: 65 passed, no skips, including wetland live settlement,
  duplicate delivery, the 30-coin cap, Stars and historical eligibility. Component
  Ruff formatting/lint and mypy passed. The aggregate Python command also checks
  the unchanged `deploy/scripts/backend-smoke.py`, which has pre-existing formatting
  differences; that file was left untouched.
- Independent review identified and resolved validation parity, nested route
  ownership, configured obstacle width and witness-observation defects. Its final
  targeted recheck found no remaining blocker in the bounded scope.
- Existing legacy fixtures and all 13 pre-existing modified/untracked UI files
  were preserved; hashes were checked separately from the new feature diff.

The survival corpus uses seeds 0/2/9, initial vertical offsets -5000/0/+5000 and
velocities -500/0/+500: 27 traces reach 33 scored stations at maximum speed. Only
objects whose centers reach global screen X <= 360000 are observed; the complete
observation matures after 18 ticks. All ten selectable adjacent family edges are
asserted from completed four-station encounters, rather than generated horizon
content.

Seven selected reward entries collect the complete trails in blocks 0–6 (two
coins for introductory/recovery encounters, four for quick/pressure encounters)
and survive through the following station. Four additional entries collect Stars
at stations 12–15, covering pipes, vines, rocks and debris, and survive the next
exit. These witnesses run at maximum speed, use varied selected initial states,
and obey the same visibility/delay rule. They use expanded generation horizons and
capacities and selected Star schedules to isolate catalog routes. They are bounded
controller evidence for the declared physics/catalog, not proof for arbitrary
custom configurations or every entry state. The shared raw state/event fixtures
remain short cases; a shared long-input replay is a deferred enhancement.

Owner playtesting must assess challenge, understandable deaths and tempting reward
routes. Physical Telegram/mobile and hosted acceptance are separate gates and are
not implied by local unit, fixture or database checks.

For owner playtesting, start a new flight and check that the first eight stations
teach the silhouettes, later spacing changes are readable, and choosing rewards
adds risk while skipping them leaves a useful survival route. Try collecting a
Star and returning to the following obstacle, then pause/resume near a hazard.
Record the seed/run and the maneuver when a death feels unavoidable or unclear.
