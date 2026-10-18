# Wetland challenges

Status: implemented locally on `feature/wetland-challenges`; verification recorded
October 19, 2026. Owner playtesting, physical Telegram/mobile and hosted acceptance
remain open. Passing automated controllers do not establish universal reachability
or human playability.

## Gameplay contract

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

Economy policy `verified-pickups-v3-wetland` accepts the new default identity.
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

Executed results on the completed implementation:

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
