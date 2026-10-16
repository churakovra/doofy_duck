# MVP gameplay, economy, and pilot specifications

Status: specification preparation, with local challenge implementation described in section 1. This document turns the owner-approved direction in [Product
vision](PRODUCT_VISION.md) into bounded engineering contracts. Product choices marked **Open** remain unapproved. They block
only the milestone that depends on them.

Read this with the [development plan](DEVELOPMENT_PLAN.md), [current simulation rules](ARCADE_SIMULATION.md), [foundation
boundaries](FOUNDATION.md), [service architecture](ADR-001-MICROSERVICES.md), and [currency/broker
proposal](ADR-003-CURRENCY-AND-BROKER.md). Current gameplay is local TypeScript and Go simulation; the commercial services,
account, persistent run lifecycle, ledger, and continue are not implemented. The
current challenge contract is defined in the linked simulation rules.

## Decision labels and authority

- **Requirement** means an owner-approved product constraint in Product Vision or an existing repository contract.
- **Proposal** means a bounded technical default for implementation review. It does not imply product approval or provider
  guarantees.
- **Open** means the named owner must decide or accept the milestone evidence.
- Numeric examples below are
  testable engineering draft values only unless explicitly called an existing requirement. They are not approved gameplay
  tuning, prices, budgets, launch policy, or business targets.

## 1. Challenge generation and feasibility

### Requirements

- Runs use seeded, reproducible, varied challenge sequences. Difficulty rises in steps, with recovery room between demanding
  sections.
- Every generated transition has a route achievable under the actual physics and enough time to react. Purchases,
  balances, records, and collection choices do not affect the challenge.
- Randomness may frustrate simple repeated-input
  scripts; it is not bot protection. Verification and abuse controls remain separate.
- TS and Go remain a shared
  deterministic contract. A fixed run pins its rule, generator, challenge-set, and reward-policy versions.

### Local implementation: bounded challenge families

Each family is immutable configuration data consumed by both simulations. It
defines ordered integer gap centers and a band; gap height and horizontal spacing
remain shared pipe configuration. The default routes are steady, rise, dip and
offset, with a steady recovery family. Collectible placement remains a separate
seeded choice within the safe inner opening.

The local draft uses four-pipe families: one intro block, two cruise blocks, then
alternating pressure and recovery blocks. Pressure is the cap. Seeded family
selection is indexed by encounter order, so pre-generation cannot advance a band
while paused or stamp every upcoming family with the generation tick. This
replaces the earlier proposed 15/30-second band boundaries; the independent speed
ramp remains. Exact tuning still needs owner playtests before release.

Keep family geometry within validated world bounds. Feasibility evidence must
identify entry states, actual generated geometry, flight time and control inputs,
and use the fixed-step simulation with collision checks. A visual overlap test
alone is insufficient. Evidence for the default catalog does not establish
universal reachability for arbitrary custom physics/catalogs.

### Feasibility and reaction acceptance

Local tests define a conservative observation point when the next pipe center is
at X `360000` in the 360-pixel logical viewport. With cap speed `4800`, contact
starts at center X `138000`, giving a geometric approach interval of 46.25 ticks.
This interval is not a latest-safe-flap deadline.

The bounded transition witness continues stabilizing in the previous exit lane
for **18 ticks (300 ms)** before steering to the new family. It samples entry Y
at the previous family exit center ±5000 and vertical velocity ±500, including
zero. This replaces the earlier unvalidated 45-tick draft; it establishes a
successful delayed-controller route for those samples, not a universal reaction
floor or an envelope closed under every composed exit state. Human reaction
acceptance and final tuning remain owner playtest gates.

Acceptance evidence for GAME:

1. Given the same seed and versioned descriptor, TS and Go produce identical family IDs, geometry, collectible facts, event
  order, and state across horizon refill and pruning.
2. Property/semantic checks cover minimum/maximum geometry, band
  transitions, recovery insertion, repeat limits, and seed reproducibility. Invalid family data fails descriptor/config
  validation rather than yielding partial runs.

3. Every selectable transition has a reproducible witness checked by actual flight dynamics from boundary states in its entry
  envelope. Record the shortest required reaction window; reject any below the configured floor.
4. Run a bounded
  deterministic seed corpus across all families and transitions; report coverage and counterexamples. A single autopilot
  surviving one seed is not a reachability proof.
5. Owner playtests review challenge, variety, and recovery before numeric
  tuning is frozen. Simulation fixtures are updated only after reviewed rule changes.

**Exact next gate:** gameplay/product owner accepts family vocabulary, band
boundaries, transition mix, recovery frequency and reaction difficulty after
playtest. GAME is implemented locally with draft configuration; see
[executed verification and limits](CHALLENGE_RESULTS.md). Public release remains
gated on accepted playtests.

## 2. Run lifecycle and durable checkpoints

### Proposed states

A run has a stable `run_id`, account owner, immutable rules/generator/reward policy versions, seed, and monotonically
increasing checkpoint sequence. Define `life_index` as 0 before the optional continue and 1 after the single authorized
continue. A checkpoint-sized settlement segment is one accepted checkpoint, not one playable life. `segment_sequence` is
assigned once per accepted checkpoint, equals that checkpoint’s sequence, and continues monotonically across both lives; it
never resets at continue.

| State | Meaning | Allowed next state |
| --- | --- | --- |
| `ACTIVE` | Inputs may be accepted and replayed | `ACTIVE`, `DEAD`, `EXPIRED`, `ABANDONED` |
| `DEAD` | Death checkpoint is verified; life 0 may offer its unused continue, life 1 is terminal | `RESUME_PENDING`, `FINALIZING` |
| `RESUME_PENDING` | One continue debit/resume authorization is being reconciled | `ACTIVE`, `DEAD`, `FINALIZING` only after authoritative resume impossibility and compensation |
| `FINALIZING` | No more play is accepted; verified segments are being closed | `FINALIZED` |
| `FINALIZED` | Terminal result recorded; no continue or new segment | none |
| `EXPIRED` | Active lease elapsed before a verified death | `FINALIZING` |
| `ABANDONED` | Player explicitly abandons this run | `FINALIZING` |

`EXPIRED` and `ABANDONED` enter the same settlement finalization path and do not erase verified checkpoint rewards. A process
restart or disconnect alone is not abandonment. `DEAD -> FINALIZING` is allowed only when no continue claim is outstanding;
while a committed claim is unresolved, all finalization mutations are fenced. Death in life 1 has no continue offer and proceeds
to finalization.

### Checkpoint and reconnect proposal

Core issues the run descriptor and a short-lived lease. Client submits bounded, ordered input batches with `(run_id, sequence,
start_tick, end_tick, inputs)` and an idempotency key. The trace must preserve every active simulation tick, including ticks
with no flap, and a defined mapping from accepted browser frame clock/input timestamps to authoritative 60 Hz ticks. Current
`InputFrame.sequence` counts FLAP inputs only and current per-step `inputHistory` is empty; neither is a checkpoint replay
contract. Add a versioned trace schema and client recorder as part of RUN before relying on replay. Core accepts the next
sequence only after replay from the last accepted authoritative state. Exact duplicate sequence plus identical payload returns
its recorded result; same sequence with different payload is a conflict. Gaps/out-of-order batches are rejected with the
expected sequence and last committed checkpoint. Client cannot submit score, totals, rewards, phase, or position as authority.

Draft engineering bound: at most 120 active ticks per checkpoint, with at most one in-flight checkpoint per run; requests have
explicit server deadlines and maximum body size. These values are implementation defaults for load and retry control, not
gameplay or provider guarantees. A client may retry a timed-out checkpoint with the same key/payload. On reconnect, it fetches
server status and resumes from the last accepted checkpoint; unacknowledged inputs may be replayed only if their sequence is
still expected. Never fast-forward simulation time while disconnected.

A run lease expiry is evaluated against server time when a mutation is serialized. Draft engineering defaults: a 30-second
checkpoint request deadline, a 10-minute reconnect grace after the last accepted checkpoint, and a 24-hour absolute run
lifetime. These are proposed bounded-service defaults, not provider limits or approved product timing. Expiry prevents
additional play; it does not void prior accepted facts. Define lease duration, renewal policy, and the exact server
clock/deadline semantics before RUN deployment. Browser visibility pause is local UX; server checkpoints remain the authority.

### Death, continue, and finalization

On each verified death, Core commits the final death checkpoint, its checkpoint-sized settlement fact, and state `DEAD`
atomically. Only a life 0 death with the continue unused offers the choice until its configured deadline; a life 1 death
proceeds directly to finalization. **Already verified segment rewards are
creditable independently of the continue choice.** Economy may show them as pending until delivery commits; it must not hold
them hostage to continue.

If the player declines or the offer expires with no continue claim in progress, Core moves the old run to `FINALIZING`; once
all accepted checkpoint-sized settlement facts are durably queued in its outbox and the final result is recorded, it becomes
`FINALIZED`.
Starting a free new run creates an independent run and does not abandon or finalize the old run. Proposed default: runs are
independently keyed and may overlap; if product later chooses one active run per account, a new free run may be deferred until
the old run resolves, never charged or denied permanently. If the player continues, preserve the same run ID, score, accepted
collections, policy versions, and prior checkpoint history, and set `life_index` to 1. Do not create an extra settlement event
at the life boundary. Continued play can earn only newly collected pickups with new collectible identities.

Safe-resume proposal: derive a deterministic resume state from the death checkpoint, retain score/collections, clear transient
collision/contact state, and place the duck at a validated safe point. Draft geometry: place the duck at its normal X
coordinate and at the death-state Y clamped to the reachable safe vertical interval for the next obstacle; if that interval is
empty, select the nearest deterministic safe lane and hold the run in `RESUME_PENDING` until the server validates
reachability. Put the next obstacle at least one configured reaction window ahead, with no obstacle/pickup collision at resume
tick. These are technical defaults requiring simulation proof and playtest, not approved visual behavior. Pin the resume
algorithm version in the run. A continue is consumed when Core durably records the unique resume authorization, not on button
click. No second continue is possible.

Continue accounting crosses Core and Economy and has no distributed ACID transaction. Use a stable `continue_id` bound to
`(account_id, run_id, dead_checkpoint, price_quote_id)`. Proposed sequence: Economy reserves/debits once idempotently and
records a durable operation; Core asks Economy for its status, then atomically records the authorization and a resume control
record that references the last accepted gameplay checkpoint. This control record does not count as an accepted gameplay
checkpoint and does not advance `checkpoint_sequence` or `segment_sequence`; only the next accepted input checkpoint advances
them. Retries query status by the same ID. If debit succeeded but Core did not resume, retry must complete that same
authorization or initiate an explicit compensating refund after proving no resume was committed. If Core resumed but the
response was lost, status returns the same resumed checkpoint without another debit. Never refund based solely on a client
timeout.

### Settlement and deduplication contract

Core emits one immutable `RunSegmentVerified.v1` fact per accepted checkpoint, including stable event ID, run/account IDs,
`life_index` (0 or 1), monotonically increasing `segment_sequence` (equal to accepted checkpoint sequence), checkpoint tick
range, verified newly-collected collectible IDs/types, score delta and cumulative score, rule identity, reward policy version,
and terminal marker where applicable. This checkpoint-sized settlement segment is emitted once for each accepted checkpoint,
including the death checkpoint; continued life does not reset the sequence or emit a duplicate for the old death checkpoint.
Resume control records do not emit settlement facts or advance sequence. Amounts are not client supplied. Economy validates
producer identity, schema, account/run binding, life/segment-sequence progression, policy version, and issuance caps.

Deduplicate at two levels: event ID and business key `(run_id, segment_sequence, reward_kind)`. Also enforce unique
collectible identity per run so replayed or resumed history cannot issue the same pickup twice. Economy records inbox/dedup
marker, ledger credit, and its result/outbox in one local transaction. Core persists accepted checkpoint and outbox fact in
one local transaction. Redelivery after consumer commit returns prior outcome. Out-of-order checkpoints remain pending/rejected
until their predecessor is known; never credit based on presumed global broker ordering.

A terminal result records final score and completion reason once, but does not re-credit prior checkpoint collectibles.
Empty/no-reward runs still finalize. Expose separate status for gameplay (`ACTIVE`/`DEAD`/terminal) and reward settlement
(`PENDING`/`COMMITTED`/`REJECTED_REVIEW`) so temporary Economy or broker outage is visible and recoverable.

### Lifecycle acceptance scenarios

- Duplicate checkpoint, same bytes: return the original accepted result and the same single checkpoint-sized settlement fact. Same sequence with changed
  bytes: conflict; state unchanged.
- Missing sequence or reconnect from a stale client: report expected sequence; no
  score/collection rollback and no client-authoritative state accepted.
- Disconnect after server commit but before response:
  retry yields the committed checkpoint; no duplicate checkpoint-sized reward.
- Crash after Core DB commit before publish: outbox
  later delivers the fact. Crash after broker accepted publish but before publisher records confirmation: duplicate delivery
  is harmless in Economy.
- Economy outage: verified checkpoint fact remains pending and is retried; death/continue offer and
  finalization remain usable; UI does not show uncommitted funds as spendable.
- Death checkpoint arrives concurrently with
  lease expiry: serialize both against run version/server time. If valid death checkpoint commits before expiry, run enters
  `DEAD`; if expiry wins, reject later input and finalize accepted prior segments. Exactly one result is observable.
- Continue click races offer expiry: Core serializes an idempotent continue claim against the offer deadline and unused slot.
  A committed claim blocks every old-run finalization path (decline, explicit abandonment, expiry, and any “start new run”
  action that would otherwise abandon it) while its debit/resume outcome is reconciled. Decline/abandon requests are rejected
  or deferred during the claim. A free new run may be created independently and does not cancel the claimed run. If expiry wins
  before claim, Economy must not debit. If claim wins, it cannot be discarded merely because the offer deadline passes during a timeout; do
  not create a second charge or silently discard the result.
- Debit times out while expiry/finalization runs: query by
  continue ID. If debit was not accepted, release the claim and finalize without charge. If accepted, complete that same
  resume, or refund/release only after Core authoritatively proves resume is impossible and Economy records the compensation.
  If resumed, report success and preserve the same run/score. A timeout alone never proves debit failure or resume
  impossibility.
- Continue claim races with decline, explicit abandonment, lease expiry, and new-run creation: claim and each old-run
  finalization mutation serialize in Core. If finalization wins first, no debit can start; if claim wins, all old-run
  finalization is blocked until debit/resume resolves. A free new run remains available independently and cannot cancel or
  invalidate the claim. The old run then either resumes once or finalizes after authoritative proof that resume is impossible
  and any required compensation is recorded.
- Decline, abandonment, or expiry after verified pickups: prior earnings still settle once. A resumed checkpoint in
  `life_index` 1 with a new collectible earns it once; replaying an old checkpoint, collectible ID, or life boundary earns no
  duplicate credit.
- Repeated
  finalization and terminal event delivery: same final result, score, and reward outcome; no new ledger entry.

**Exact next gate:** product owner approves offer duration and continue price amount in the required in-game Stars denomination, plus safe-resume player experience, and
whether explicit abandonment is exposed; Core/Economy owners accept lease/checkpoint bounds and claim/debit/resume
reconciliation. RUN may implement durable verified segments without issuing currency. WALLET requires accepted reward issuance
policy; CONTINUE requires the approved price plus debit, compensation/reconciliation, and resume contracts.

## 3. Initial economy, catalog, and payment policy

### Product structure

Use stable, opaque catalog IDs and integral minor units; never encode prices as floating point or infer exchange between
currencies. Economy owns catalog, wallet, inventory, order, payment, and refund state. Keep three visibly distinct assets:
coins (`FEATHER` storage/event ID), in-game Stars (`GAME_STAR` ID), and Telegram Stars (`XTR`). Internal Stars are not a
Telegram wallet balance and do not promise cash-out or 1:1 conversion.

Initial catalog shape:

| Product class | Fulfillment | Price denomination | Status |
| --- | --- | --- | --- |
| Earned wallet credit | Ledger entry from verified segment facts under pinned policy | Coins and/or in-game Stars | Policy open |
| Cosmetic skin | Owned entitlement; equip by stable item ID | Coins, in-game Stars, or XTR after approval | Products/prices open |
| Cosmetic background | Owned entitlement; equip by stable item ID | Coins, in-game Stars, or XTR after approval | Products/prices open |
| One continue | Run-scoped resume authorization, consumed at most once | In-game Stars per vision | Price open |
| XTR purchase | Specific wallet package or cosmetic entitlement | XTR only | Product/price/fulfillment open |

No gifts, loot boxes, leaderboards, boosters, or external reward redemption in this MVP catalog. Catalog quote includes item,
denomination, amount, catalog version, expiry, and eligibility; the server revalidates current quote/version at commit.
Cosmetics cannot change simulation hitboxes, physics, route, score, or reward eligibility.

### Earned, purchased, refund, and issuance rules

- Earned balances originate only from accepted verified facts and the pinned reward-policy version. Client event totals, local
  storage, and practice runs are never account funding evidence.
- Purchased balances/entitlements originate only from
  validated payment facts and a committed Economy fulfillment transaction. XTR remains the external payment asset; if a
  product grants an internal balance, the conversion amount and product description require explicit approval.
- Whether
  earned and purchased units share one spendable balance or remain separate lots is **Open**. Until decided, ledger entries
  must retain provenance so policy can be applied without migrating invented assumptions. Define spend ordering and refund
  treatment before purchases are enabled.
- Each policy version defines eligible event types, per-segment/per-run/account
  issuance caps, rounding, expiry (if any), and the behavior for suspended or ineligible accounts. No fixed earning rate,
  conversion, or reward budget is assumed.
- Cosmetic/internal-currency purchase debits and entitlement grant occur in one
  Economy database transaction with idempotency key and business uniqueness. Concurrent requests cannot overspend or grant
  twice.
- A refund is a separate recorded adjustment linked to original charge/order. Provider outcome may be unknown until
  confirmed. Keep entitlement and wallet response policy explicit: reversible cosmetic access may be revoked only under
  approved rules; already spent internal value may create a debt/blocked balance or require manual review. Do not silently
  subtract unrelated earned funds.
- Duplicate payment updates deduplicate by provider charge identity and order business
  rule. Mismatched payer, amount, currency, or order cannot fulfill. Multiple distinct charges for a one-time order require an
  explicit duplicate payment/refund path before sales.

Acceptance before WALLET/SHOP: policy fixtures prove eligible/ineligible, cap-boundary, duplicate event, new event ID with
duplicate business key, out-of-order segment, policy-version mismatch, concurrent debit, stale quote, and refund-pending
outcomes. A ledger audit can reconstruct every balance from entries. UI distinguishes pending, committed, and unavailable
balance states.

Acceptance before PAY: approved products have visible prices and fulfillment rules; actual provider documentation is rechecked
at implementation time; durable ingress, validation, idempotent fulfillment, cancellation, refund/status reconciliation, and
operator recovery are exercised. No provider behavior is assumed by this proposal.

**Open / gate:** owner approves launch catalog, prices in each denomination, product descriptions, balance provenance/spend
rules, earning policy/caps, refund consequences, and XTR conversion products. Do not enable paid sales or credit account
currency until the relevant rules are accepted.

## 4. Release, art, pilot, and infrastructure decision register

| Area / owner | Proposed recommendation | Exact unresolved decision | Dependent gate and acceptance |
| --- | --- | --- | --- |
| Art direction / product owner | Original friendly duck identity; readable high-contrast pipes and pickups; separate cosmetic background worlds; preserve existing renderer palette boundary | Final art style, named duck/skin/background assets, accessibility contrast and asset budget | ART: approved asset list and licensing/source record; bilingual preview/equip works; missing-asset fallback; physics and simulation identity unchanged |
| Challenge tuning / product owner + gameplay implementer | Playtest the implemented intro/cruise/pressure/recovery draft above | Family mix, progression pace, accepted human reaction window, collectible risk balance | Release tuning: owner playtests record seed/version, observed failure/recovery, and accepted tuning; bounded automated evidence and its limits remain explicit |
| Continue / product owner + Core/Economy owners | Exactly one run-bound continue; retain score and verified earnings; idempotent distributed authorization | Price amount in in-game Stars, offer duration, safe-resume presentation, refund behavior for ambiguous debit | CONTINUE: concurrency/retry/expiry acceptance above passes; TS/Go resume parity; no double debit or earnings; usability playtest accepted |
| Economy / product owner + Economy owner | Versioned policy, provenance-bearing ledger, integral units, stable catalog IDs | Earn rates/caps, coin vs in-game-Star uses, earned/purchased spend treatment, launch catalog/prices | WALLET/SHOP/PAY: policy accepted before credit; visible quotes; atomic debit/grant; ledger rebuild and refund outcomes demonstrated |
| Audience / product owner + release owner | Russian/English first; vision says intended audience 18+ | Launch countries, age-eligibility approach, legal/privacy review, support languages/process | RELEASE: documented country/age gates and required disclosures accepted; real Telegram account and both locales pass pilot checklist |
| Pilot devices / release owner | Begin with a bounded opt-in pilot; measure before selecting commercial targets | Named mobile OS/browser and desktop clients, minimum OS/device set, sample size, pilot duration | RELEASE: device matrix and numeric frame-time/memory/input thresholds agreed before test; evidence recorded on each named device |
| Budget / product owner + operations owner | Price actual hosting, broker, database, monitoring, payment/refund support, and asset costs before launch | Maximum monthly operating/payment/support budget and funded reward commitment (if any) | RELEASE: cost model and alert thresholds accepted; restore and outage drills pass within budget; no unfunded external rewards |
| Infrastructure / engineering owner + product owner | ADR-001 service boundaries; one public origin; separate service-owned data; Docker Compose local development; HTTP checkpoints; RabbitMQ is current broker recommendation | Approve FastAPI/aiogram adapter, Go HTTP/pgx/sqlc, SQLAlchemy/Alembic, PostgreSQL per-service ownership, RabbitMQ/topology/hosting, secrets and deployment approach | ACCOUNT/RUN: reproducible local startup, auth/ownership/contract checks, durable outbox/inbox and real DB/broker failure tests; broker/provider guarantees verified from official docs at implementation |
| Measurement/privacy / product owner + privacy/release owner | Measure voluntary replay, retention, purchase and fulfillment correctness with data minimization | Events, consent/disclosure, retention, access, deletion, analytics vendor, numeric targets after pilot | RELEASE: approved measurement/privacy plan and deletion/access handling before collection; targets derived from pilot evidence, never invented in this spec |

These recommendations are proposals, not approvals. Product prices, currency rates, launch countries, age controls, final
artwork, operating/reward budgets, and numerical business targets remain open. The 18+ audience direction is an existing
requirement; implementation and eligibility policy are not yet decided. Infrastructure tool choices in ADR-001 and RabbitMQ in
ADR-003 remain proposals until their stated owners accept them. Recheck live provider and tool contracts when implementing
integrations; this specification grants no provider guarantee.

## 5. Milestone gates

- **GAME** is implemented locally with versioned challenge structures and draft
  defaults. Freeze release tuning only after owner playtests; retain the bounded
  feasibility evidence and its limits in release review.
- **ACCOUNT/RUN** can design service contracts and persist/verify runs
  with no currency issuance. Define and test lease, checkpoint, reconnect, death, expiry, abandonment, and terminal-result
  semantics before production use.
- **WALLET** waits for accepted earning eligibility, policy versioning, caps, and durable
  retry/dedup rules. Pending rewards must be visible and not spendable until committed.
- **ART** can prototype with
  development-only catalog data while direction is open. SHOP and commercial assets wait for approved inventory and prices.
- **CONTINUE** waits for approved price/offer behavior and tested debit/resume reconciliation. No client-only resume
  authority.
- **PAY/RELEASE** wait for approved products/prices, countries/age policy, privacy/support, deployment budget,
  and provider-specific validation. Confirm actual provider contracts and test flows at implementation time.

A gate blocks only its dependent feature. Translation, local prototypes, contract drafting, and non-commercial simulation
evidence can continue while product decisions remain open.
