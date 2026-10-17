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

## 2. Approved ACCOUNT/RUN lifecycle

The October 17 owner decisions replace the earlier per-checkpoint settlement and
independent concurrent-run proposals. See [backend foundation](BACKEND_FOUNDATION.md)
for implementation evidence and acceptance targets.

### Issuance, checkpoints and ownership

Core issues account-owned run IDs, seeds and immutable simulation/configuration
identities. Permit one unresolved run per account. An explicit device takeover
rotates a writer generation and opaque writer credential; stale writes and stale
abandonment requests fail. Recovery reads do not grant writer ownership.

Record exact active simulation ticks, including ticks with no FLAP. Submit ordered
batches of 1–120 ticks with a stable sequence/idempotency key. Replay from the last
accepted state; identical retries return the original result, changed duplicates
conflict, gaps return the expected sequence. Client positions, scores and balances
are not authority. Save state/checkpoint evidence atomically before acknowledgment.

### Outages, recovery and limits

A new account-backed flight requires successful server issuance. Known unavailability
blocks starts with a bilingual error and Retry. Existing flights continue locally
through network/server failures and can finish. Persist the bounded unsent trace in
IndexedDB per account/run; storage failure permits play with a warning that close or
reload may lose unsent progress. Never fast-forward simulation while paused.

Cap each run at 216,000 active ticks (one hour); pauses consume no ticks. Cap
completion is distinct from collision death. The normal submission grace is one hour
without accepted server contact. A persisted operator/server-recorded outage that
overlaps the grace extends eligibility through one hour after recovery; clients
cannot claim their own extension.

On reload, reconcile accepted state and retained inputs before resuming. Other
devices recover only accepted server state; takeover explicitly warns that unsent
inputs on the previous device cannot be recovered remotely. Allow confirmed explicit
abandonment of an unfinished run, discarding unsubmitted progress.

### Verification and future settlement

A locally finished flight shows waiting/retry until verified or definitively
rejected. The next account-backed flight waits for this result. Gameplay verification
and completion-fact delivery have distinct statuses; a delivery outage is recoverable.

Checkpoints preserve collection evidence but never credit currency during flight.
On each verified death or cap completion, Core atomically records one immutable
`RunLifeCompleted.v1` event with its outbox entry. Authenticated HTTP delivery retries
to Python; the inbox deduplicates event ID and `(run_id, life_index)` with a canonical
payload conflict check. Persist receipt and deduplication in one transaction.

Issuance is disabled. Show verified pickup counts with a rewards-disabled explanation,
not a spendable balance. Future WALLET requires approved earning eligibility/rates/caps
and ledger rules. Future CONTINUE preserves the run ID and score, allows at most one
continue, and credits only new earnings from its next life; credit at the first death
must not wait for a continue decision. Resume, payment and compensation remain later
features and must fence finalization against outstanding authorization.

### Required acceptance

Test forged/cross-account requests, concurrent starts, duplicate/conflicting/reordered
checkpoints, stale writers, reload, takeover, storage failure, cap/deadline boundaries,
offline finish and later replay, outage extensions, and definitive rejection.
Inject crashes before/after commit and delivery acknowledgment; accepted work survives
and completion delivery has one business effect. Run real PostgreSQL tests as well
as deterministic simulation parity. Input verification does not prove human play.

## 3. Initial economy, catalog, and payment policy

### Product structure

Use stable, opaque catalog IDs and integral minor units; never encode prices as floating point or infer exchange between
currencies. Economy owns catalog, wallet, inventory, order, payment, and refund state. Keep three visibly distinct assets:
coins (`FEATHER` storage/event ID), in-game Stars (`GAME_STAR` ID), and Telegram Stars (`XTR`). Internal Stars are not a
Telegram wallet balance and do not promise cash-out or 1:1 conversion.

Initial catalog shape:

| Product class | Fulfillment | Price denomination | Status |
| --- | --- | --- | --- |
| Earned wallet credit | Ledger entry from verified completion facts under pinned policy | Coins and/or in-game Stars | Policy open |
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
- Each policy version defines eligible event types, per-life/per-run/account
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
duplicate business key, out-of-order completion, policy-version mismatch, concurrent debit, stale quote, and refund-pending
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
| Infrastructure / engineering owner + product owner | Approved two applications: Python Platform/Economy and Go Core; FastAPI/Pydantic, SQLAlchemy/Alembic, pgx/sqlc; separate PostgreSQL databases; Compose; HTTP outbox/inbox | Hosting provider, measured sizing, monthly budget, deployment approval and HA configuration; RabbitMQ deferred | ACCOUNT/RUN: local startup, auth/ownership/contracts and real DB failure tests; hosted acceptance requires 1,000 active flights, failover/restore evidence and budget approval |
| Measurement/privacy / product owner + privacy/release owner | Measure voluntary replay, retention, purchase and fulfillment correctness with data minimization | Events, consent/disclosure, retention, access, deletion, analytics vendor, numeric targets after pilot | RELEASE: approved measurement/privacy plan and deletion/access handling before collection; targets derived from pilot evidence, never invented in this spec |

These recommendations are proposals, not approvals. Product prices, currency rates, launch countries, age controls, final
artwork, operating/reward budgets, and numerical business targets remain open. The 18+ audience direction is an existing
requirement; implementation and eligibility policy are not yet decided. The two-application stack and HTTP delivery in ADR-001/ADR-003 are approved; hosted provider, capacity and cost acceptance remain open. Recheck live provider and tool contracts when implementing
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
