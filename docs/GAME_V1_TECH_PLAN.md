# Doofy Duck v1.0.0 — technical requirements and implementation plan

Status: proposed implementation contract, not implemented or released. Product scope: GAME_V1_SPEC.md. This plan keeps the owner's four pillars: generated pipe patterns, tap-to-fly duck/death, one point per passed pipe pair, and occasional configurable currency subclasses. Add only lifecycle, reproducibility, presentation, persistence, and tests needed for a reliable foundation.

## 1. Scope and runtime

First playable: one browser application; no live valuable rewards, account wallet, payments, broker, or database. The larger Python Platform/Economy and Go Core architecture is not replaced, but full infrastructure is not a prerequisite for flight development.

v1 engineering work includes the native Go simulation/parity runner. It need not run as a network service for the standalone game. Telegram access is a browser-hosting smoke test, not proof of Telegram authentication, age eligibility, payment support, or production readiness.

Baseline: TypeScript pure simulation; React UI shell; PixiJS renderer; Vite development/build; Vitest and property-based tests for rules; Playwright for browser interaction; Go standard tests for the equivalent native simulation. No shared cross-language business library, engine framework, WASM, WebSockets, or ECS is required. Dependency/toolchain versions must be verified, pinned, and locked during scaffolding, not guessed here.

Proposed source layout:

```text
apps/web/                       # React shell, renderer, input, storage
packages/game-sim/               # pure TypeScript simulation
services/core/simulation/       # pure Go equivalent, no HTTP requirement yet
contracts/simulation/           # descriptors, rules, common golden fixtures
docs/
```

Keep manifests, dependency environments, and tests independent. Do not create empty Platform/Economy applications just to fill the planned directory tree.

## 2. Traceable technical requirements

### TR-01 — Run states and input

Use READY, RUNNING, PAUSED, DEAD. First press starts and flaps exactly once. Queue accepted input for the next simulation tick; pointer input and non-repeating Space input use the same action. One press cannot produce both touch and mouse flaps. No gameplay input changes state after death. Pause freezes simulation; resume requires an explicit action and clears stale held input. Restart creates a new run identity and fully resets transient state.

### TR-02 — Tick and numeric rules

Use a fixed simulation step; proposed initial rate is 60 ticks per second. Treat it as a versioned constant, not a device-dependent timer. Represent gameplay positions/velocities in documented integer subpixel units, with explicit numeric bounds, rounding, and overflow handling matching Go. Specify the exact order of input application and integration. Keep numeric defaults tunable in a validated configuration, then freeze that configuration per run.

Rendering may interpolate but never advances gameplay independently. Bound work per animation callback. On a sufficiently large scheduling gap, pause instead of silently skipping simulation ticks or performing an unbounded catch-up. This standalone pause behavior must be revisited for future server-time/reward eligibility contracts.

### TR-03 — Generation

A pattern is an ordered list of pipe spacing and gap-center values. Begin with a small catalog, fixed speed, and one gap size. Use a specified seeded PRNG and test vectors; an implementation must not use platform-default random calls. Catalog order and spawn-call order are versioned. One gameplay PRNG is sufficient initially; visual-only operations cannot consume it.

Add a safe opening and a short generation horizon. Validate pattern internals and all allowed pattern-to-pattern transitions against the actual flight model. Use a reachability test/solver with documented limits; rejection checks alone must not be described as a proof of playability. Reject invalid configurations. Generate/cleanup incrementally; stable IDs must not depend on recycled array indexes.

### TR-04 — Movement, collision, and score

Use a fixed duck horizontal position, vertical gravity/flap response, and a falling-speed bound. Use a stable AABB hitbox independent of animation. Proposed boundary rule: floor/ceiling/pipe contact, including edge contact, is lethal. Ensure movement cannot tunnel through a collider: validate per-tick movement limits or implement swept tests.

Proposed tick order: consume input → integrate motion → update required world geometry → resolve lethal collision → only if alive, award passed pipes and apply pickups → cleanup and produce events. Score a pair once after its trailing edge passes the duck hitbox's left edge. A lethal tick produces neither a new score nor a new pickup. DEAD is terminal; old results cannot be changed by restart.

### TR-05 — Collectible base class and subclasses

Use a small abstract Collectible contract with concrete Feather and GameStar implementations. Immutable definitions contain type/version, spawn weight, minimum pipe index, minimum spacing, amount, pickup geometry, and appearance key. Runtime instances contain stable ID, position, and collected state. Do not put renderer objects, wallet clients, or timers in definitions.

The pickup method returns a typed deterministic effect/event. Both initial currencies use the same stationary world behavior; different amounts or art do not require additional subclasses. Future bonuses may return non-currency effects, but no booster/effect-stacking engine is implemented now.

At each eligible pipe, filter by spacing/eligibility, then choose one entry from a table including NONE. At most one collectible per opportunity. Place inside validated safe geometry. Award once and remove it. Check that disabling all types works and invalid/negative/overflowing weights or amounts are rejected.

### TR-06 — Pure core and versioned contracts

Simulation accepts descriptor + state + tick inputs and returns next state + events. Dependencies on DOM, React, PixiJS, Telegram, storage, wall clock, or network are forbidden in the core.

Descriptor: runId, seed, simulationVersion, generatorVersion, configId. The immutable configuration includes patterns and collectible definitions; retain exact fixtures/configuration for reproducibility. Inputs include sequence/tick and action; reject invalid order/ranges. Events include PipePassed, CurrencyCollected, and RunEnded with stable source identities and ticks. These are local facts, not broker integrations or authorization to credit a wallet.

### TR-07 — Presentation and adapters

One logical portrait playfield with fixed forward visibility; scale/letterbox without changing the gameplay space. React controls screens and HUD; PixiJS draws the world. No per-frame React state updates for every object. Rendering and input resources must be released on unmount/restart. Use one placeholder duck/world. Include loading/failure messaging if renderer initialization fails; final visual style remains separate work.

### TR-08 — Persistence and currency meaning

Persist completed local best and minimal settings behind a storage adapter with a schema version. Validate stored values; tolerate missing/corrupt/unavailable storage. Local state is untrusted and must never become authoritative leaderboard evidence or an account balance. Run pickup totals survive death in the result but are not silently accumulated as redeemable claims. Label GAME_STAR as practice in the standalone build; no relationship to Telegram XTR is promised.

### TR-09 — Bounded runtime

Discard past world entities. Limit input queues, renderer resources, and diagnostic buffers. Incremental verification fixtures may retain test inputs on disk, not the entire endless history in live gameplay memory. Test coordinate rebasing or another explicitly bounded coordinate representation before numeric limits are reached. Rebased state must preserve collisions, PRNG state, stable IDs, and world progress.

Performance targets are proposals to establish on named devices. Measure frame timing, active object counts, heap trend, load size, and restart/mount cleanup. No active-player capacity or universal frame-rate claim is justified by a local test.

### TR-10 — Cross-language parity

Run identical descriptors and tick inputs through TypeScript and Go. Compare canonical gameplay states and ordered events—not only final score. Fixtures include flap/gravity, PRNG output, pattern boundaries, edge collisions, death-plus-pickup, duplicate scoring, long runs, and rebasing. Any mismatch blocks acceptance of server-authoritative use. Implement the shared rule set, not a Go HTTP/payment service.

### TR-11 — Build, tests, and local workflow

Provide documented clean-checkout setup, development start, lint/typecheck, focused tests, full tests, parity, browser tests, and production build. Exact commands are deliverables of scaffolding; none are executable project commands yet. Pin runtime/dependency versions and retain lockfiles. CI executes the same checks. Tests are written and run before behavior implementation, with concise RED/GREEN evidence; independent review follows each slice.

### TR-12 — Browser and Telegram acceptance

Exercise touch/keyboard, resize, visibility changes, pause/resume, first-tap semantics, storage failure, repeated restarts, and renderer teardown. Test production assets through a temporary HTTPS URL in selected real Telegram clients. Keep bot tokens outside frontend code and Git. Authenticated accounts and money remain absent. User/device results must be recorded separately from Playwright emulation.

## 3. Ordered implementation tasks

Each task is a reviewable slice. Do not implement later social/economy features inside these tasks.

| Task | Dependency | Deliverable and acceptance | Requirements |
|---|---|---|---|
| V1-01 Scaffold and rule contracts | None | Reproducible workspace, locked tools, validated descriptor/config schemas, test/build commands; no speculative service skeletons | TR-06, TR-11 |
| V1-02 Flight and run lifecycle | V1-01 | Input → fixed ticks → flight → boundaries → death/restart; focused tests demonstrate input and state ordering | TR-01, TR-02, TR-04 |
| V1-03 First playable renderer | V1-02 | Actual tap-to-fly screen, one fixed pipe pair, score and restart; browser interaction exercised | TR-04, TR-07 |
| V1-04 Seeded pattern generation | V1-03 | Replace fixed pipe with endless catalog; safe opening, transition checks, once-only scoring and cleanup | TR-03, TR-04, TR-09 |
| V1-05 Currency subclasses | V1-04 | Feather/GameStar definitions, NONE selection, safe spawning and once-only pickup; no account wallet | TR-05, TR-08 |
| V1-06 Lifecycle/mobile hardening | V1-05 | Background pause, explicit resume, resizing, personal best, storage failures, repeated restarts and bounded long runs tested | TR-01, TR-07, TR-08, TR-09 |
| V1-07 Go simulation parity | V1-04; extend with V1-05/06 fixtures | Matching native rules and canonical states/events, including PRNG/collision/pickups/rebasing; no network service required | TR-02, TR-03, TR-04, TR-05, TR-06, TR-09, TR-10 |
| V1-08 Release-candidate checks | V1-06, V1-07 | CI and build pass; real Telegram/device evidence, reviewed known issues and release notes | TR-10, TR-11, TR-12 |

Begin visual playtesting at V1-03 rather than waiting for every system. Revalidate fixtures when tuning changes; never blanket-update golden files to hide a regression. A new configuration identity is required when gameplay tuning changes.

## 4. Definition of done

Every task has executed acceptance evidence and independent review. Clean checkout can run the app using documented commands. Scope remains the simple game. Functional/property/browser tests and TypeScript/Go parity pass; generator limits and device results are documented. Memory/object growth is measured over a declared long-run scenario. No fake wallet, fake provider result, or implied production authentication exists. Known limitations distinguish the standalone practice build from a commercial launch.

Only then consider a v1.0.0 tag; this document does not create one. No credible fixed schedule is assigned until the first playable establishes actual iteration cost.
