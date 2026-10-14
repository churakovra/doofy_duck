# Doofy Duck v1 — requirements QA checklist

Status: **requirements review / proposed acceptance probes**. This checklist does not report implementation or test results. Each case is a target for executable evidence once the owning implementation exists. Keep pure simulation evidence separate from browser/Go/device evidence; a mock or short run cannot prove real-client behavior, universal generator safety, bounded lifetime memory, or commercial readiness.

## Evidence conventions

- **Core** means deterministic simulation tests without DOM, React, PixiJS, storage, wall clock, network, or Telegram. Record exact descriptor/config, tick-indexed input, ordered state/event output, and assertion.
- **Frontend** means browser integration tests against real adapters/render scheduling, not only mocked callbacks. Record browser/device, viewport, actions, and observed result.
- **Go/parity** means native Go test execution against the same canonical fixture bytes as TypeScript; compare full canonical state and ordered events, not just final score.
- **Device** means an actual selected desktop/mobile Telegram client and deployed temporary HTTPS build. Playwright/WebView emulation is not device evidence.
- Any changed gameplay rule, catalog, or tuning must receive a new configuration/version identity; do not update expected fixtures wholesale to make a mismatch disappear.

## Traceable acceptance probes

### TR-01 — Run states, input, and lifecycle

**Pure core**
- [ ] From READY, deliver one accepted press on tick `t`: transition to RUNNING and apply exactly one flap on `t`; do not add a second flap on the next tick while the source remains held.
- [ ] Deliver a press in RUNNING and confirm one queued action is consumed on the specified next simulation tick. Deliver duplicate sequence/tick, out-of-order, and out-of-range inputs and assert the documented reject/ignore behavior without extra flap/events.
- [ ] Submit equivalent accepted pointer and Space actions and compare resulting state. Repeated Space keydown while held must not synthesize repeat flaps.
- [ ] Dead-state input, pause-state queued input, and stale held input after resume produce no movement or score until a new explicit action.
- [ ] Restart after DEAD returns READY with a new runId, reset score/pickups/world/input buffers, and no mutation or second finalization of the prior result.

**Frontend**
- [ ] A single physical touch that also dispatches compatibility mouse events yields one action. Check touch/pointer/mouse paths and a genuine subsequent click separately; one gesture must not flap twice.
- [ ] Repeated mount/unmount and restart do not multiply listeners or deliver inputs to an old run. Verify by counting observable input actions, not merely checking that handlers exist.

**Acceptance evidence:** transition table plus boundary/input tests; browser interaction run for touch and keyboard. A synthetic browser event cannot establish device-specific touch event ordering.

### TR-02 — Fixed ticks, numeric rules, and render independence

**Pure core**
- [ ] Verify explicit tick order at the first tick and at a boundary: accepted input → integration → world update → lethal collision → score/pickup only if alive → cleanup/events, matching the chosen contract.
- [ ] Use the same descriptor and tick-indexed inputs under render schedules representing 30, 60, 120, irregular, and zero-extra-draw frames. Canonical simulation state and ordered events must be identical when the same simulation ticks are advanced.
- [ ] Exercise integer subpixel rounding, negative coordinates if valid, maximum configured velocity, numeric bounds, and overflow/rejection. Assert exact results, not approximate visual similarity.
- [ ] A simulated large scheduler gap follows the documented bounded-work policy: pause rather than skip gameplay ticks or execute unbounded catch-up. No wall-clock time enters the pure core.

**Frontend**
- [ ] Drive rendering faster and slower than the fixed step; draw/interpolation count cannot change score, PRNG position, collision, or event count.
- [ ] Inject a long animation-frame gap and verify bounded callback work and visible safe pause behavior; resume requires explicit user action.

**Acceptance evidence:** fixed-step unit/property tests and a browser scheduler probe. A handful of frame rates does not prove behavior for all schedules; define the tested gap and numeric bounds.

### TR-03 — Descriptor, configuration, PRNG, and generation constraints

**Pure core**
- [ ] Validate descriptor fields `runId`, `seed`, `simulationVersion`, `generatorVersion`, and `configId`; test missing, malformed, unsupported versions and invalid numeric domains. No implicit defaults may make an invalid descriptor silently valid unless explicitly specified.
- [ ] Validate immutable config identity against the exact pattern catalog and collectible definitions. Mutating a config during a run is rejected or cannot affect that run.
- [ ] Pin PRNG algorithm, seed expansion, integer output/range mapping, and call order with known vectors. Same descriptor plus same tick inputs reproduces identical canonical state/events; changed seed/config/version is not assumed to produce different output for every short fixture, but must select the specified stream/config.
- [ ] Assert gameplay contains no platform-default randomness; renderer-only random draws and extra rendering do not advance gameplay PRNG state.
- [ ] Test catalog ordering and spawn-call ordering as versioned behavior. Repeated generation and fixture replay must retain stable pipe/collectible IDs independent of recycled array indexes.
- [ ] Reject negative, non-finite, out-of-range, and invalid combination values for physics, pattern spacing/gaps, weights, pickup amounts, and geometry. Validate zero-weight/disabled entries explicitly.

**Acceptance evidence:** schema validation, PRNG golden vectors, determinism replay, and config identity tests in TS and Go. A seed alone is insufficient evidence without pinned algorithm, versions, and call order.

### TR-04 — Flight, collision/death precedence, boundary reachability, and score timing

**Pure core**
- [ ] Boundary matrix: duck AABB exactly touches and then crosses floor, ceiling, pipe sides, and pipe gap edges. Apply the selected edge-contact rule consistently; exact contact is lethal under the proposed plan.
- [ ] Exercise collider crossing between ticks at the maximum allowed world/duck displacement. Assert either swept collision catches it or validated movement bounds make tunneling impossible.
- [ ] On a tick where collision and a pipe scoring condition coincide, assert RunEnded/death precedence and no new point. Previously earned score remains.
- [ ] Score edge probe: advance a pipe so its trailing edge is just before, exactly at, and just beyond the specified scoring boundary (plan says trailing edge passes the duck hitbox's left edge). Assert score changes once at the documented tick, not on elapsed time or visual overlap. Repeat with the pair already marked passed and through restart.
- [ ] Test score and event identity under cleanup/rebasing; a pair can emit one PipePassed only, and a terminal run cannot later change its result.
- [ ] Validate opening lead-in and each allowed pattern transition with actual flight reachability checks under the configured physics, including catalog wraparound and the final-to-first transition. Include hardest permitted spacing/gap-center extrema, not only typical seeds.

**Acceptance evidence:** deterministic edge fixtures plus documented reachability solver assumptions, bounds, and rejected configs. A visual gap inspection or sampled “many seeds” run is not proof every allowed transition is reachable.

### TR-05 — Collectible contract, subclass tuning, NONE weights, and once-only pickup

**Pure core**
- [ ] Validate `Feather` and `GameStar` definitions: stable type/version IDs, appearance key, integer amount, pickup geometry, spawn weight, minimum eligible pipe index, and minimum spacing. Test invalid/negative/overflowing amounts and weights.
- [ ] Prove ordinary tuning changes are definition/config data, not new behavior subclasses; both initial types can share stationary behavior while preserving type-specific amount/appearance/configuration.
- [ ] At every eligible pipe opportunity, apply eligibility and spacing filters before one deterministic weighted selection including explicit NONE. Test all-zero item weights with positive NONE, NONE weight zero with eligible types, a type blocked by spacing, and a sole eligible type. Assert at most one object and no independent-roll overlap.
- [ ] Pin weight-boundary mapping with PRNG vectors: values at each cumulative boundary select the documented bucket; invalid total weight is rejected, never divide-by-zero or silently omit NONE.
- [ ] Test safe placement wholly within the validated passage and required obstacle clearance; unsafe configs/placements reject or select NONE per the documented rule, never clip into a solid collider.
- [ ] Pickup exactly once at the chosen geometry boundary. Duplicate collision processing, duplicate input, object revisit, or repeated tick cannot emit a second typed event/amount. Event carries stable runId, collectibleId, typeId, amount, and tick; removal follows the specified event rule.
- [ ] On a lethal tick with a pickup overlap, assert no new pickup event or run-total increase. Earlier collected totals remain in final result.
- [ ] Verify GAME_STAR is only a local practice counter and is not XTR, wallet credit, or redeemable value.

**Acceptance evidence:** weighted-selection boundary vectors, placement/collision tests, subclass/config tests, and typed-event assertions. A short seeded run showing a collectible once does not validate distribution or NONE probability.

### TR-06 — Pure core boundary, versioned contracts, and event ordering

**Pure core**
- [ ] Import/dependency check confirms core modules do not depend on DOM, React, PixiJS, Telegram, storage, wall clock, HTTP, or wallet clients.
- [ ] For a fixed fixture, compare complete next state and ordered events, including stable source IDs and tick values. Test same-tick event ordering for death, score, pickup, and cleanup according to the selected precedence.
- [ ] Reject invalid input sequence/tick ranges and unsupported descriptor/config versions with specified errors and no partial state mutation.
- [ ] Event replay/idempotency probe: processing the same pickup/score source twice cannot award twice; RunEnded is emitted once and restart cannot reopen or rewrite the old run.

**Acceptance evidence:** dependency-boundary/static check and canonical fixture output. This proves local deterministic facts only, not authorization for external account credit.

### TR-07 — Presentation, resize, and resource teardown

**Frontend**
- [ ] At supported portrait aspect ratios and viewport sizes, logical gameplay coordinates, collision, pipe spacing, and identical forward gameplay visibility remain fixed; letterboxing/scaling cannot reveal extra actionable world or alter rules.
- [ ] Resize during READY, RUNNING, PAUSED, and DEAD; state, runId, score, PRNG, and canonical next simulation result remain unchanged. HUD stays visible and controls remain reachable.
- [ ] Renderer initialization failure presents a recoverable explanation/action and does not leave a ticking invisible simulation or orphaned listeners/resources.
- [ ] Repeated mount/unmount and restart dispose renderer/application resources, observers, frame callbacks, audio, and input listeners. Assert no old-run callbacks and collect repeated-cycle resource/heap observations; do not claim zero leaks from one cycle.
- [ ] Verify visual interpolation/cosmetic changes do not alter gameplay state or consume gameplay PRNG.

**Acceptance evidence:** browser test plus repeated-cycle profiling on named browser/device. A mocked renderer cannot establish GPU/WebGL teardown behavior.

### TR-08 — Pause/resume and storage resilience

**Pure core**
- [ ] PAUSED freezes all simulation ticks, world generation, movement, scoring, pickups, and simulation-time progression. Resume is explicit and stale queued/held input is discarded.
- [ ] Test pause requested at tick boundaries and repeated pause/resume; no time debt causes an unexpected flap, catch-up burst, or event on resume.

**Frontend/storage adapter**
- [ ] Visibility loss/backgrounding while RUNNING enters PAUSED; return stays PAUSED until clear user resume. Exercise visibility changes in READY, DEAD, and already-PAUSED states per documented behavior.
- [ ] Storage matrix: missing key, valid current schema, prior schema, malformed JSON, wrong types, negative/too-large best, quota/write error, read exception, and unavailable storage. App remains playable; invalid data is rejected safely and failure never corrupts run state.
- [ ] Only completed results update personal best; best equals max(valid prior best, completed score). A storage failure must not block restart. Run collectibles remain distinct from durable personal best/account balance.

**Acceptance evidence:** adapter fault-injection tests and browser visibility tests. Mock storage covers adapter error handling, not browser/private-mode or device-specific persistence policy.

### TR-09 — Bounded live state and long-run/rebase evidence

**Pure core**
- [ ] Run declared deterministic long scenarios across multiple seeds/configs. Record tick count, generated/discarded objects, peak active entities, input queue length, diagnostic buffer length, coordinate magnitude, and PRNG/rebase state.
- [ ] Assert active world objects, queued inputs, and live diagnostics remain within explicit caps independent of total run length; removed entities are not retained in gameplay state/history.
- [ ] Reach coordinate-rebase threshold and compare pre/post-rebase collision, world progress, stable IDs, PRNG stream, score, and events against a non-rebased reference where feasible. Exercise repeated rebases and boundaries.
- [ ] Include maximum supported speeds and pattern boundaries in long runs; verify no numeric overflow or ID collision.

**Frontend**
- [ ] Repeated restart/mount/unmount and a long browser session: record heap and renderer resource trend plus active object count; investigate monotonic growth.

**Acceptance evidence:** executable long-run test with declared duration/seeds and bounded-state assertions, plus named-browser profiling. A short run cannot establish long-horizon bounds; a finite test only supports the declared workload and invariants, not “zero leaks” or universal safety.

### TR-10 — Canonical TypeScript/Go parity

**Go/parity**
- [ ] Execute identical shared canonical fixtures in TypeScript and Go and compare serialized gameplay state and ordered event streams, not only score or final state.
- [ ] Fixture set includes PRNG vectors, flap/gravity and numeric rounding, first-tap semantics, pattern internal and cross-boundary transitions, exact edge collision, swept/tunneling case, lethal tick plus score, lethal tick plus pickup, duplicate score/pickup, NONE selection/weight boundaries, pause/restart, long run, and coordinate rebasing.
- [ ] Include invalid descriptor/config/input cases and require equivalent reject/ignore semantics and no partial mutation.
- [ ] Canonical encoding defines key ordering, integer representation, absent/null fields, event ordering, and error representation so serializer differences do not mask semantic equality.
- [ ] Any mismatch blocks use of the Go result as an authoritative verifier; retain minimized failing fixture and do not regenerate both sides from one implementation.

**Acceptance evidence:** exact commands, fixture revision/hash, per-language outputs, and full parity result. Go compilation or shared schema parsing alone is not gameplay parity.

### TR-11 — Build, tests, and reproducible workflow

**Implementation/release-candidate evidence**
- [ ] From a clean checkout, documented pinned runtime/dependency setup succeeds without machine-global unpinned installs; lockfiles are present and direct versions are exact.
- [ ] Run and report lint, typecheck, focused core tests, full tests, property tests, Go tests, parity, browser tests, and production build as separate results. Do not imply an unrun command passed.
- [ ] Confirm CI runs the same commands and fixtures as the documented local workflow; failures retain diagnostic evidence.
- [ ] Confirm test-first evidence/independent review is recorded for implementation slices; QA checklist itself does not claim RED/GREEN or code review occurred.

**Acceptance evidence:** clean-checkout command log and CI run. A developer's already-installed workspace build is not clean-checkout reproducibility.

### TR-12 — Browser and real Telegram-client acceptance

**Browser emulation (not device proof)**
- [ ] Playwright exercises touch/keyboard, first tap, duplicate event suppression, resize, visibility pause/resume, storage failure, repeated restart, renderer teardown, score/death UI, and initialization failure.
- [ ] Label browser/device versions and emulation settings. Keep these results explicitly separate from real Telegram-client evidence.

**Real-client gate**
- [ ] On the selected real desktop/mobile Telegram clients, open the production-asset build over temporary HTTPS; record date, client/platform/device, viewport/orientation, build/config identity, scenario, observed outcome, and issues. Verify first-tap semantics, touch, resize, background/resume, restart, and asset loading.
- [ ] No bot token, credential, live account, payment, public tunnel, or valuable reward is needed for this foundation smoke test. Do not infer Telegram authentication, age eligibility, payment support, XTR behavior, bot-proofness, or production approval from opening the game in a client.
- [ ] Agree and measure device performance targets on named devices; do not infer target performance from desktop Playwright.

**Acceptance evidence:** dated real-client/device record supplied by owner/tester. Browser emulation, screenshots of a browser, or a hosted page alone cannot establish actual Telegram client behavior.

## Separate gates and limits of evidence

### Pure-core gate (first; no UI or network)

TR-01 through TR-06 and core portions of TR-08/TR-09 must be covered by deterministic tests and bounded/property checks. These establish the specified simulation behavior only. They do not establish usable controls, rendering correctness, browser storage, actual device behavior, security against automated play, or any external value.

### Frontend and Go gate

Frontend adapters/rendering/lifecycle/storage probes in TR-01/02/07/08/09/12 require browser execution. TR-10 requires independently executed Go behavior against common fixtures. Mocks can isolate error paths but cannot substitute for actual renderer lifecycle, storage policy, scheduler behavior, or cross-language runtime execution.

### Future commercial release gate (out of v1 foundation scope)

Not established here: account identity/authorization, anti-cheat or bot resistance, server-authoritative reward eligibility, wallet/economy correctness, payment or Telegram Stars support, redemption, age/jurisdiction eligibility, production security/operations, capacity, support, or release readiness. These need separate approved contracts, threat/economic/legal review, and production-system evidence before valuable rewards or commercial launch. No local counter or parity test should be represented as account credit or a commercial guarantee.

## Contract ambiguities / minimal parent decisions

These requirements are not fully consistent or precise enough for interoperable fixtures. Resolve and version the smallest rule before implementation depends on it:

1. **Score crossing edge:** Spec TR-04 says award when the pair's trailing edge passes the duck hitbox's left edge; GAME_V1_SPEC says trailing edge passes the duck, without defining the reference point. Choose one exact coordinate comparison and equality tick; encode an edge fixture.
2. **Queued-input timing:** TR-01 says queue for the next simulation tick, while first READY press starts and flaps exactly once. Specify whether an event received immediately before tick `t` affects `t` or `t+1`, and treatment of multiple presses queued for one tick.
3. **Pointer duplicate definition:** “one touch cannot also produce a duplicate mouse flap” does not state pointer-event preference, compatibility-event suppression window, or whether two rapid genuine taps are distinct. Define gesture identity/deduplication without a time heuristic that drops real taps.
4. **Pause state transitions:** Visibility loss enters pause, while READY/DEAD behavior and repeated visibility changes are unstated. Choose no-op vs PAUSED behavior for each non-RUNNING state and define whether explicit resume from PAUSED starts/flaps (recommended: it must not; require a fresh press).
5. **Fixed-step overload:** A sufficiently large gap pauses, but “sufficiently large,” accumulator treatment, and gap at exact threshold are not defined. Specify threshold in ticks/time, discard/reset policy, and visible resume requirement.
6. **Generator feasibility domain:** “Validate ... under actual physics” and “documented limits” require a declared supported configuration domain, solver assumptions, transition composition rules, and what happens when no safe transition exists. Keep a small finite catalog/transition domain; reject unsupported configs rather than claiming universal reachability.
7. **Weighted NONE selection:** NONE is explicit, but whether weights are integer, max total, and how a total of zero is interpreted are unspecified. Define integer bounded weights and reject total zero (or explicitly define guaranteed NONE); pin inclusive/exclusive cumulative boundaries.
8. **Pickup vs lethal collision:** Lethal tick precedence clearly suppresses new pickups, but collision and pickup geometry equality and simultaneous non-lethal score/pickup event ordering need a canonical ordering. Preserve previously collected totals.
9. **Config identity/version compatibility:** Descriptor lists both simulation/generator versions and configId, but no canonical hashing/retention or unsupported-version behavior is specified. Define configId as an immutable catalog/config identity and keep exact old definitions needed by recorded fixtures; do not imply arbitrary historical replay support unless built.
10. **Restart and finalization:** “never duplicates finalization” has no formal finalization API in this standalone core. Define RunEnded once per runId and the result snapshot as immutable; defer external persistence/idempotency semantics to a later contract.
11. **Resize visibility:** “enough identical forward visibility” and supported aspect ratios/device set are not numerically defined. Choose supported logical viewport/aspect bounds and verify identical actionable simulation visibility; outside them letterbox or reject unsupported layout rather than changing physics.
12. **Storage migration:** Schema version is required, but migration policy and personal-best upper bound/source are not. Define safe handling for unknown future versions and invalid values; storage remains untrusted convenience data.
13. **Go delivery phase:** Tech plan includes native Go simulation/parity in v1 engineering, while Phase B dispatches the Go agent after Phase A contract verification. This is compatible if Go work is explicitly gated on the frozen Phase A API/fixtures; avoid treating Go parity as complete before that handoff.
14. **“v1.0.0 candidate” vs release:** Tech plan defines candidate checks but also makes release tag contingent on all gates; clarify that checklist completion alone is not authorization to tag or commercially release.
