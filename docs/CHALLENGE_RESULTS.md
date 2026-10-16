# Stepped challenges — implementation verification

Date: October 17, 2026. Feature 1 / GAME is implemented locally on
`feature/stepped-challenges`. This report describes this task's checks; it does
not validate commercial readiness or replace owner/device acceptance.

## Delivered behavior

The TypeScript and Go simulations share a frozen challenge catalog. Four intro
pipes lead into eight seeded cruise pipes, followed by alternating seeded
pressure and steady recovery families. Pressure is the difficulty cap. The
schedule is indexed by pipe encounter order, independent of collectible RNG,
balances and purchases; pause freezes play and restart resets progression.

The default speed cap is 4800 milli-pixels/tick (288 pixels/second) and spacing is
300000 milli-pixels. The existing active-time speed ramp remains separate from
the challenge steps. Catalog validation covers family geometry, references,
intro lead-in and all selectable boundaries. Both runtimes preserve configuration
ownership and matching pipe metadata. Custom configurations may explicitly opt
out with `challenges: null`; omitted and null challenge sets have one identity.

Rules: simulation `1.3.0`, generator `1.2.0`, config `dd-v1-stepped-v1`, fixture
revision `stepped-challenges-1`. See [current rules](ARCADE_SIMULATION.md).

## Executed checks

- `GOCACHE=/tmp/duffy-go-cache npm run check` passed: types, lint, 212 unit/fixture
  tests in 22 files, native Go tests and production build.
- `GOCACHE=/tmp/duffy-go-cache npm run test:parity` passed: 25 TS fixture checks
  and the native Go suite.
- Native race tests, `go vet`, Go formatting and diff/whitespace checks passed.
  A task-local Go cache was used because the default cache was outside writable
  roots.
- Focused TDD began with missing family metadata/schedule/recovery failures, then
  passed after implementation. Existing gap-only and synthetic narrow-geometry
  regression fixtures explicitly opt out; their event/pickup assertions remain.
- Independent review found and resolved native metadata pointer aliasing,
  validation parity, and authored lead-in/boundary compatibility issues. Final
  independent review reported no findings.

The build retains its non-blocking bundle-size warning. Browser suites, physical
devices, Telegram clients and performance benchmarks were not run in this task.

## Physics and replay evidence

Both runtimes execute real collision/flight steps for all 26 selectable directed
family edges, with nine sampled entry states each: previous-family exit-center Y
offsets -5000/0/5000 and vertical velocities -500/0/500. All 234 witnesses cross the
destination family's four pipes after retaining the previous lane target for
18 ticks before adapting.

The conservative observation point is pipe center X360000. At cap speed4800,
collision entry is X138000, giving 46.25 ticks of geometric approach. The
18-tick hold is a controller-specific delayed-response witness (300ms), not a
calculation of the universally latest safe flap or a validated human reaction
floor. Subsequent targets and corpus controls wait for center X≤360000 before
reading a new gap.

The unfiltered 64-seed corpus survives 5000 ticks per seed in each runtime,
observes all 26 edges, and exercises normal refill. Shared raw-state replay adds
one default traversal with ten 500-tick snapshots through all bands, ending at
score73. The contract now has 13 cases, 40 operations and 29200 advance ticks.
The prior 24000-tick custom witness retains its original speed/spacing under
explicit gap-only generation. Fixture updates were authorized for the reviewed
rule/version change after semantic checks, not regenerated to hide a mismatch.

## Limits and remaining acceptance

The sampled entry envelope is not proven closed under every composed exit state.
A broader controller probe found a failing `cruise-rise → pressure-offset` route
at Y offset0 and velocity-1000 with the same delayed controller. This is evidence
of that controller/envelope limit, not proof that the transition has no possible
route. Neither bounded witnesses nor a finite seed corpus prove universal
reachability across all seeds, states or arbitrary custom physics.

Owner playtests must accept challenge variety, recovery and reaction difficulty
before release tuning is frozen. Named-device/Telegram input, viewport, audio,
performance and sustained-memory acceptance remain open. Backend accounts,
authoritative progress, shop, continues and payments remain future features in
the [development plan](DEVELOPMENT_PLAN.md).
