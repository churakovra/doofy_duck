# Development plan toward the first public release

Updated October 17, 2026, after feature 1 verification and local wardrobe implementation. This is a proposed
implementation sequence, not approval of prices, economics, infrastructure
deployment, or unresolved game mechanics.

Authority: [Product vision](PRODUCT_VISION.md) defines requirements;
[ADR-001](ADR-001-MICROSERVICES.md), [ADR-002](ADR-002-CLIENT-AND-REWARDS.md), and
[ADR-003](ADR-003-CURRENCY-AND-BROKER.md) define selected technical directions
and proposals. [Foundation](FOUNDATION.md) describes current extension boundaries.

## MVP finish line

Use the approved first public version as the commercial MVP: a player opens the
game in Telegram, authenticates, plays a fair varied run, keeps verified earnings,
optionally continues once, buys and equips cosmetics, and can complete an actual
XTR purchase with recoverable fulfillment. Progress survives reloads and another
device. The whole loop works in Russian and English on the pilot devices.

The local playable foundation already exists. A free Telegram pilot is a useful
intermediate delivery, but it does not finish the approved commercial scope.
Payments and one paid continue remain required unless the owner changes the vision.

The October 16 planning review inspected source and scope without executing
application checks. Feature 1 checks executed on October 17 are recorded in
[challenge verification](CHALLENGE_RESULTS.md). Historical reports retain their
execution dates; Telegram/device acceptance remains open.

## Prioritized feature backlog

These are proposed feature boundaries, not time estimates or approved numeric
economics. The milestone sections below provide the detailed acceptance rules.
Implement each coherent feature on its own branch with TDD and the reviews
required by the root instructions.

| Order / ID | Feature and player outcome | Depends on | Completion evidence |
| --- | --- | --- | --- |
| Preparation / SPEC — done | Prepare challenge, run/continue/settlement and economy specifications; register art, pilot and infrastructure decisions | Product vision and current-code review | [Specification package](MVP_SPECIFICATIONS.md); acceptance examples and owned decision gates; completion recorded below |
| 1 / GAME — done locally | Stepped challenge families and recovery sections make repeated flights varied and fair | SPEC: difficulty | [Implementation and checks](CHALLENGE_RESULTS.md); bounded physics evidence passed; owner tuning/device acceptance remains open |
| 2 / ACCOUNT | Launch inside Telegram and access the player's own account | Identity contracts, service/tooling decisions | Authenticated Platform/Core/Economy skeleton; forged, expired and cross-user access rejected; real Telegram launch |
| 3 / RUN | Save server-verified free-run progress and best score | ACCOUNT; lifecycle spec | Go checkpoint replay, durable accepted results, bounded retry/reconnect/expiry behavior; no currency issuance yet |
| 4 / WALLET | Keep verified coins and in-game Stars across devices | RUN; approved issuance policy and durable delivery | Ledger credit from verified facts; duplicate/out-of-order delivery and outage recovery; pending credit visible |
| 5 / ART — functional locally; launch art open | Choose a duck skin and background through a usable preview flow | Local test content implemented; approved visual direction/assets remain a release gate | Stable catalog IDs, independent preview/apply, local equipment saving and image fallback; approved launch assets still required |
| 6 / SHOP | Buy specific cosmetics at visible prices and equip owned items | WALLET, ART, approved prices | Atomic debit/grant, ownership enforcement, concurrent/repeated request checks and cross-device persistence |
| 7 / CONTINUE | Spend in-game Stars to continue once with the score preserved | WALLET; specified lifecycle, price and safe resume | TS/Go parity; no second continue, duplicate charge or duplicate earnings; debit/resume reconciliation |
| 8 / PAY | Complete actual Telegram Stars purchases and receive the purchased entitlement | ACCOUNT; catalog, order and fulfillment rules | Validated payment ingress, idempotent fulfillment, cancellation/status/refund reconciliation and controlled end-to-end acceptance |
| 9 / RELEASE | Reliably play and buy in the public Telegram MVP | GAME through PAY; launch policy | Real-device bilingual acceptance, performance evidence, support, monitoring, backup/restore and failure drills |

Operations, privacy/measurement design and abuse controls start with ACCOUNT and
grow with each backend feature. They are part of delivering those features, not
a final cleanup task. ART functionality uses temporary test content and can
overlap GAME and ACCOUNT; commercial artwork still requires visual direction
approval. PAY can overlap later SHOP/CONTINUE work after order contracts settle.
Existing audio, settings and translation systems need extension and acceptance,
not replacement.

### Feature 1 implementation — October 17, 2026

- [x] Implement seeded intro/cruise/pressure families and recovery in TypeScript
  and Go, with frozen run configuration, validation and matching pipe metadata.
- [x] Preserve pause/restart behavior and an explicit gap-only custom-config path.
- [x] Test all 26 selectable edges with 234 sampled delayed-controller witnesses
  and an unfiltered 64-seed, 5000-tick corpus in both languages.
- [x] Deliberately update identities/schema and reviewed raw fixtures, including
  a default traversal across all bands/refill and preserved legacy witnesses.
- [x] Pass routine checks (212 tests, types, lint, Go and build), parity, native
  race/vet, formatting/diff checks and independent review.
- [ ] Accept human difficulty/reaction tuning through owner playtests.
- [ ] Complete real Telegram/device performance and input acceptance at release.

Local feature implementation is done. The [verification report](CHALLENGE_RESULTS.md)
records the bounded evidence and counterexample limits; the unchecked items are
release acceptance, not claims established by automated tests.

### Feature 5 local wardrobe — October 17, 2026

- [x] Add three freely selectable test skins and three worlds with stable IDs,
  independent draft preview, Apply/cancel and bilingual non-game-state controls.
- [x] Save device-local equipment IDs with validation and visible session-only
  fallback; keep cosmetics outside simulation identity and commercial ownership.
- [x] Share procedural drawing and optional body/wing/background image placement
  between preview and gameplay, with fallback and asynchronous lifecycle guards.
- [x] Pass focused web checks, full routine verification (250 unit/fixture tests,
  types, lint, Go tests and production build), independent lifecycle review,
  documentation links and diff checks on this implementation. Routine verification
  used a temporary writable Go cache because the sandbox restricts the default.
- [ ] Approve final visual direction, launch assets and licensing/source records.
- [ ] Complete browser layout/resource decoding and real Telegram/device acceptance;
  browser suites were not run for this implementation.

Functionality is complete locally with temporary content. The
[authoring guide](COSMETICS.md) describes adding items and replacing artwork
without changing saved IDs or the wardrobe flow. This does not complete SHOP or
approve commercial artwork.

### Specification preparation — October 16, 2026

- [x] Deliver [MVP specifications](MVP_SPECIFICATIONS.md): proposed challenge
  families/progression/recovery and feasibility criteria; checkpoint, death,
  continue, expiry and settlement contracts; economy/catalog policy structure.
- [x] Include acceptance scenarios for retries, duplicate/out-of-order delivery,
  crashes, continue/finalization races and preservation of verified earnings.
- [x] Record open product, art, pilot and infrastructure decisions with responsible
  roles, acceptance criteria and dependent feature gates.
- [x] Review against current source and product direction; complete independent
  lifecycle/accounting review and resolve its sequencing and concurrency findings.
- [x] Verify relative file links and whitespace/diff checks on the completed docs.

**SPEC preparation is complete. Product approval remains open.** This status does
not approve draft timing/tuning, prices, earning/refund policy, art, launch policy,
budget or infrastructure proposals. This preparatory completion alone did not
implement GAME or backend features; GAME implementation is recorded separately
above. Open decisions block only their dependent work as specified below.
Verification for this documentation-only step is link/diff inspection and review;
application, browser and real-device checks were not run in this step.

## Immediate next batch

The owner approved two backend applications, managed PostgreSQL, HTTP outbox/inbox
delivery, one unresolved flight per account and offline completion/recovery. See
[backend foundation](BACKEND_FOUNDATION.md) for the full approved bounds, load target
and implementation evidence. Currency issuance remains disabled until earning rules
are approved. Checkpoints save evidence; credit is only eligible after a verified
death or cap completion. The next account-backed flight waits for result verification.

GAME and ART are implemented locally. ACCOUNT and RUN are the authorized next
engineering work, with WALLET activation, SHOP, CONTINUE and PAY remaining later gates.

The owner needs to decide challenge targets and recovery behavior, continue price
and safe-resume behavior, launch products/prices and earning rules, visual
direction, and pilot countries/devices/budget. Engineering should propose the
checkpoint/retry contracts and pending broker/tooling decisions for review.
No arbitrary prices, currency conversion or delivery dates are assumed here.

## Release checklist

- The complete authenticated flight → death/optional continue → verified credit
  → shop/equip → XTR purchase loop passes agreed acceptance scenarios.
- Refresh, device changes, duplicate requests, disconnections and process crashes
  preserve accepted progress and cannot duplicate charges or entitlements.
- Local practice balances cannot become account funds; coins, in-game Stars and
  XTR remain visibly distinct.
- Approved launch content, prices, country/age policy, privacy information and
  payment-support process are ready before public sales.
- Both languages pass real Telegram mobile/desktop checks, including input,
  viewport, audio and measured sustained performance on named pilot devices.
- Relevant routine, parity, native, integration and explicitly requested browser
  checks pass on the release state; operators can restore data and reconcile
  pending payments/rewards. Pilot metrics can measure replay, retention,
  purchases, operating costs and fulfillment correctness.

Gifts, loot boxes, leaderboards, social challenges and boosters do not block this
finish line. Avoid assigning a completion percentage from feature counts:
authoritative progress, commerce and release operations are substantial work
despite the already playable client.

## Requirement coverage today

| First-release requirement | Current state | Remaining work |
| --- | --- | --- |
| Single-tap flight, scoring, free new runs | Implemented locally | Telegram/device acceptance and gameplay tuning |
| Varied, stepped, fair challenges with recovery | Implemented locally: seeded families/recovery and bounded TS/Go physics evidence | Owner playtests/final tuning, real-device acceptance; universal reachability is not established |
| Telegram Mini App and saved player progress | Browser game and untrusted local storage | Telegram integration, identity, authoritative services and persistence |
| Coins and in-game Stars, separate from XTR | Product wording aligned; `FEATHER`/`GAME_STAR` local balances | Approved issuance policy, authoritative ledger |
| Owned/equipped skins and backgrounds | Local wardrobe with three test skins/worlds, preview/apply, saved equipment and replaceable image resources | Approved launch art, authoritative inventory/equip, shop and purchase transactions |
| Actual Telegram Stars purchases | Not implemented | Product/pricing decisions, provider integration, fulfillment and refunds |
| At most one paid continue preserving score | Death is terminal | Lifecycle design, safe resume, authorization and accounting |
| Russian and English | Typed bilingual catalogs, saved locale selection, localized errors and plurals | Real Telegram/device acceptance in both languages |
| Operational and abuse protection | Local validation and simulation parity | Service authorization, limits, detection, monitoring and recovery |

## Delivery sequence

Each milestone needs a short behavior specification, failing tests first,
implementation, relevant checks, and independent review. Keep each feature on
its own branch. Do not wait until the final milestone to integrate the services.

### 0. Resolve requirements that affect contracts

Specification preparation is complete through backlog step SPEC above. Decision
approval remains open in the [specification register](MVP_SPECIFICATIONS.md);
this milestone does not claim every contract-affecting choice is resolved.

Produce focused specifications for:

- Difficulty: challenge families, progression steps/cap, recovery intervals,
  minimum reaction window, and how achievable transitions are assessed.
- Run lifecycle: checkpoints, pause, reconnect, expiry, first death, continue
  eligibility, abandonment, final completion, and reward settlement timing.
  Distinguish awaiting a continue decision from irrevocable run finalization;
  this must not hold already earned currency hostage to that decision.
- Continue: price denomination, safe-resume placement/timing, score and collection
  retention, offer expiry, and failure/retry recovery. Maximum one per run.
- Economy: initial products, visible prices, earned/purchased balance rules,
  issuance limits, and refund consequences. No assumed currency conversion rate.
- Release: launch countries, age-eligibility approach, final art direction,
  operating budget, and pilot device/performance acceptance criteria.
- Infrastructure: choose the proposed frameworks, database tooling, and broker.
  Authenticated HTTP outbox/inbox delivery is approved; RabbitMQ is deferred.

Acceptance: decisions have owners and explicit acceptance rules; unresolved
items stay visible and block only their dependent work. Translations, gameplay
experiments, and contract drafts can proceed in parallel. Provider-dependent
implementation must recheck official provider documentation at that time.

### 1. Align the playable client with the product language

Implemented locally: typed Russian/English message catalogs, locale selection
and saved preference. Switching language preserves the current run and renderer.
Unavailable storage keeps language selection usable for the current session.

Use “coins” and “in-game Stars” consistently in player-facing text; retain
existing simulation IDs and local storage schemas. Keep XTR visibly separate. Translate errors, controls, accessibility labels, and currency plurals.
Keep local-practice labels accurate until account progress exists.

Acceptance: every player-facing message has both translations, switching locale
preserves the current run, and no wording implies withdrawals or live gifts.

### 2. Build the approved challenge system

Local implementation is complete as feature 1 / GAME above; see
[current rules](ARCADE_SIMULATION.md) and [verification](CHALLENGE_RESULTS.md).
Seeded generation includes recovery and pins rules/generator/configuration per
run. Purchases and balances do not influence difficulty. Final owner tuning and
release acceptance remain open.

Acceptance: semantic tests and reviewed fixtures agree across both languages;
transition checks use actual flight dynamics and reaction constraints;
representative sequences have recorded feasibility evidence. A controller
surviving one seed is insufficient evidence for all generated transitions.
Owner playtests assess challenge, variety, and recovery before tuning is frozen.

### 3. Prototype the cosmetic experience

Implemented locally as feature 5 / ART functionality: three procedural test skins
and three worlds, stable catalog IDs, independent draft selection, combined
preview, explicit Apply/cancel, and device-local equipment preferences. Optional
body/wing/background images share preview/gameplay placement with procedural
fallback and guarded asynchronous loading. See the
[cosmetic authoring guide](COSMETICS.md) for adding or replacing content.

Final visual direction, approved launch assets and source/licensing records
remain open. Test selections are not proof of commercial ownership; account
inventory and purchases remain SHOP work. Browser and real-device acceptance
have not been established by this local implementation.

Acceptance: changing appearance leaves hitboxes, rules identity, scoring and
replay outcomes unchanged; missing assets have a usable fallback. The flow is
usable in both languages. Account ownership/purchases arrive in milestone 6.

### 4. Establish Telegram identity and service contracts

Implement the approved Python application (Platform and Economy modules) and Go Core
behind one public origin. Start with an authenticated end-to-end
service skeleton, versioned HTTP/event contracts, service-owned database
migrations/credentials, and reproducible local startup. Use authenticated HTTP delivery with transactional outbox/inbox handling; defer RabbitMQ.

Platform validates Telegram initialization and issues application credentials.
Core/Economy independently enforce token validity and resource ownership.
Integrate Telegram launch, viewport/safe areas, visibility and activation behavior.
Provide explicit development authentication separate from production validation.

Acceptance: a real Telegram test account reaches its own account state; expired,
forged or cross-user requests fail. Each service builds independently; no service
reads another service's database. Contract compatibility checks enter CI.

### 5. Deliver verified gameplay into authoritative progress

Build the first complete backend slice: authenticate → issue a server-owned run
descriptor → play locally → submit bounded ordered input checkpoints → replay
in Go → persist verified facts → credit Economy under a pinned reward policy →
show committed balances and best score.

Specify bounded input buffers, retry/sequence rules, reconnect and expiry.
Persist completion evidence/outbox atomically in Core; deduplicate event and business
identities in the Python Economy inbox. Checkpoints do not issue currency during flight. Show pending credit during outages. Keep local practice
progress separate; never import client balances as authoritative funds.
Design first-death/continue/final-completion states now, even if paid continue
activation waits for milestone 7.

Deliver this in two increments: first persist authenticated verified free-run
checkpoints/results without issuing currency; then connect approved reward policy
and durable Economy credit. Verification can advance while pricing or broker
decisions are still being resolved.

Acceptance: duplicate/reordered checkpoints, delivery redelivery, process crashes,
and temporary Economy outages do not lose accepted work or credit it twice.
Forged score/position/currency claims are rejected. Account state survives reload
and another device. Input verification alone is not human-play detection.

### 6. Connect the shop and equipment to Economy

Implement the approved catalog, owned inventory, equip operations, and purchases
using internal coins/in-game Stars. Economy validates prices and ownership and
atomically debits balances and grants items. Replace development inventory with
account-backed data. Make insufficient funds, pending operations, retries, and
stale quotes understandable in both languages.

Acceptance: concurrent or repeated requests cannot overspend or duplicate a
single purchase; unowned items cannot be equipped. Ownership/equipment persist
across devices. Cosmetic selection cannot change gameplay.

### 7. Implement one authorized continue

Implement the specified resume transition in both simulations and its server
authorization/accounting workflow. Keep the same run identity and score, enforce
one continue, and preserve existing collected earnings independently of whether
the player continues. Define how Economy debit and Core resume recover when
either service fails; a distributed transaction is not implied.
Bind each authorization to the account, run and eligible dead checkpoint; expose
status reconciliation for uncertain debit/resume outcomes.

Acceptance: insufficient funds, duplicate clicks, delayed responses, disconnects,
and crashes cannot cause repeated charges, a second continue, or duplicate
earnings. Verified earnings are retained when declining the offer. Safe resume
passes parity, reaction-window tests and owner playtests. New runs remain free.

### 8. Integrate XTR purchases and fulfillment

Implement approved XTR products using Economy orders and Platform provider
transport. Verify payer/order/amount/currency/charge before granting anything.
Handle pre-checkout within provider deadlines; persist authenticated payment
ingress durably before acknowledgment. Add payment status, reconciliation,
refund handling and operator recovery before enabling sales.

Acceptance: cancellation, duplicate updates, mismatched payment fields, delayed
fulfillment, crashes, and ambiguous refund outcomes have tested recovery paths.
Balances and entitlements change only after validated fulfillment. Complete
provider-supported test flows and controlled end-to-end acceptance before launch.

### 9. Pass release acceptance and run a bounded pilot

Apply the chosen country/age policy and operational abuse controls. Establish
secrets management, rate/resource limits, audit trails, alerts, backups with
restore drills, migration/rollback procedures, and payment support processes.
Track voluntary replay, retention, purchases, costs and fulfillment correctness;
define pilot measurement and privacy requirements before collecting events.
Choose numeric targets from pilot evidence, as the vision requires.

Acceptance: the full flight → death/optional continue → earned credit → shop/equip
loop works in real Telegram mobile and desktop clients in both languages. Record
named-device input/audio/viewport, frame-time and sustained-memory evidence.
Run routine, parity, native, browser, real-database/broker and system failure
checks appropriate to the delivered features. Open acceptance blockers remain
explicit; prior verification reports do not validate later changes.

## Dependencies and work that can overlap

- Milestone 1 is implemented locally; real-device acceptance remains open.
  Milestones 2 and 3 can progress in parallel
  once their focused design decisions exist.
- Milestone 4 contract design can overlap local gameplay/art work. Milestone 5
  depends on identity, durable services and the run/economy specifications.
- Milestone 6 depends on authoritative account progress. Milestone 7 depends on
  the designed lifecycle and authoritative debit/resume workflow.
- Milestone 8 can overlap later shop/continue work after catalog, order and
  accounting contracts stabilize. Milestone 9 includes all release gates;
  operational work begins alongside the first backend slice.

## Recommended next work

Implement feature 2 / ACCOUNT after the dependent infrastructure/authentication
decisions in the [specification package](MVP_SPECIFICATIONS.md). The next backend
slice is authenticated verified free runs, followed by authoritative wallet
credit when issuance and durable delivery are decided. In parallel, collect
owner feedback on the implemented challenge tuning; keep its acceptance limits
visible rather than treating the automated witnesses as a human playtest.

## Deliberately after the first public release

Gifts/redemption, loot boxes, leaderboards, friend invitations/challenges,
magnets, abilities and starting boosters stay outside this release. Daily routes
remain unconfirmed. A player-facing statistics feature is not currently required;
add it only after specifying its metrics and authoritative settlement behavior.
Operational/pilot measurements still belong in release work. Later gifts require
their own funded rules, eligibility, delivery/reconciliation and acceptance plan.
