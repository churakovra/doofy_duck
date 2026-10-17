# SHOP implementation backlog

Planning date: October 17, 2026. This breaks development-plan item 6 into
reviewable milestones, including its unfinished WALLET prerequisite. It approves
no earning rates, prices, launch assets, spending, or deployment. No SHOP code is
implemented by this document.

## Scope and architecture

Deliver account-backed coins/in-game Stars, owned skins/backgrounds, persistent
equipment and specific cosmetic purchases at visible prices. Preserve free local
practice and its independent wallet/wardrobe. XTR payments, paid continue, gifts,
loot boxes, trading and leaderboards remain later milestones.

Use the existing Python application and Economy database. Wallet, catalog,
inventory and purchase modules share an Economy transaction; no new service,
broker or distributed purchase transaction is needed. Core continues delivering
verified completion facts and never reads Economy tables.

```mermaid
flowchart LR
    A[Core verified completion] --> B[Economy durable inbox]
    B --> C[Versioned settlement]
    C --> D[Wallet ledger and balance]
    E[Shop quote] --> F[Purchase transaction]
    D --> F
    F --> G[Owned inventory]
    G --> H[Account equipment]
    H --> I[Existing renderer and wardrobe]
```

## Decision gates

| Gate | Decisions / evidence | Blocks |
| --- | --- | --- |
| G0 Foundation | Collect outage/reconnect result; resolve failures; real Telegram account/recovery acceptance | Accepting authenticated runs and enabling SHOP |
| G1 Earning | Eligible completions/accounts, rates by currency, per-life/run/account caps and cap windows, rounding, expiry or none, suspension handling | Production settlement/issuance |
| G2 Historical facts | Whether pre-activation verified facts earn anything; activation boundary and explicit backfill/reconciliation rules | Settlement activation |
| G3 Spending | Spendable provenance, ordering of earned/purchased units, adjustment/refund consequences; purchased funding stays disabled in this slice | Purchase activation; purchased lots require their own PAY approval |
| G4 Catalog | Starter grants, stable item IDs, approved skins/backgrounds/assets/descriptions, prices/currencies, sale eligibility, quote lifetime and delisting behavior | Live catalog, grants and purchases |
| G5 Release | Physical Telegram checks in both languages, pilot access rules, operational acceptance, provider/budget/deployment approval | Hosted rollout |

Use one price denomination per offer and explicit preview before purchase.
The owner approved permanent ownership and no self-service refunds for the initial
internal-currency shop. Support corrections use audited adjustments. XTR payment
refund rules remain a separate PAY decision. Do not silently make all existing test cosmetics owned or paid.
Account and practice equipment must not overwrite each other's selections.

## Owner direction received during implementation

October 17 follow-up: coins are the ordinary internal currency; coin cosmetic
prices should span 20–1,000. In-game Stars are premium, available from gameplay,
later Telegram Stars funding and explicitly defined events; Star cosmetic prices
start around 100–200. The owner requests a 1:1 funding denomination for purchased
in-game Stars versus Telegram Stars. This is direction for the later PAY contract,
not payment activation, interchangeability of assets or a cash-out promise.

The owner approved 1:1 verified pickup credit with a hard per-run cap of 30 coins.
The earlier proposed seven-Star cap was explicitly superseded: gameplay Stars have
no hard seven-Star ceiling. Proposed generation is one Star per 8–16 score points,
with difficulty targeting typical deaths around score 50–70. The owner approved seeded collectible spawning every 8–16 passed pipes: credit
requires actual collection. Natural-difficulty tuning targets typical deaths,
with no scripted death or score ceiling. Implement generation changes in a
separate TypeScript/Go parity milestone with authored fixtures and independent
review; exact placement and reachability follow existing simulation conventions.

Coins need no task completion; practice remains local and cannot fund account
purchases. The owner approved authenticated Telegram users earning/spending
gameplay Stars without prior donation or mandatory tasks. Purchased credit requires
a validated successful XTR payment; payment ability is not an eligibility precheck.
Before wallet activation gameplay earns coins only, not Stars; retained server-verified historical coin facts are approved for once-only backfill,
capped at 30 per run. Activation cutoff, dry-run and execution controls still need
definition before any backfill runs. No existing practice balances are imported.

Initial catalog direction: 2–3 coin-priced and two Star-priced cosmetics for each
of skins and maps/backgrounds. The owner accepted proposing two coin-priced and two Star-priced items per
category plus one additional free default. The owner subsequently approved the catalog and prices below. Premium visual
assets still require visual approval; cosmetics do not alter gameplay. Coin-priced
items are not zero-cost items. Current storage work does not activate rewards.

The owner confirmed intentionally stopping Docker during the interrupted recovery
test. Do not interpret that test's final failed submissions as a backend failure;
a fresh complete recovery measurement remains required.

## Milestones and tasks

Tasks below include meaningful tests first, expected-red execution, focused
verification and worker self-review under root AGENTS.md. Each milestone has its
own branch; keep one implementation owner through revisions.

### M0 — Close prerequisites and freeze contracts

- P0.1 Collect the existing bounded outage test; reconcile acknowledged sequences,
  input ticks and delivery backlog. Record result and any limitation separately
  from managed failover.
- P0.2 Run real Telegram authentication/recovery acceptance with an owner-provided
  test environment. Record desktop/mobile and RU/EN evidence; never claim unit
  tests substitute for this.
- P0.3 Resolve G1–G4 into a versioned policy/catalog decision sheet with examples:
  eligible/ineligible run, cap boundary, delayed/out-of-order fact, first purchase,
  insufficient funds, stale quote and concurrent purchase.
- P0.4 Define versioned API/error contracts and shared IDs before code: wallet,
  settlement status, catalog, quote, purchase lookup, inventory and equipment.
  Define policy selection and ordering for delayed facts and cap windows.
- P0.5 Define migration/rollback and feature-flag sequence. Keep receipt ingestion
  active while issuance/purchasing are off.

Acceptance: no unresolved financial behavior is embedded as an implementation
default; required gates and blocked tasks are explicit.

### M1 — Authoritative WALLET storage and read API

- W1.1 Add Alembic models/migrations for wallets by account/currency, immutable
  ledger transactions/entries, balance projections and unique business references.
  Preserve integer units and currency separation; define overflow bounds.
- W1.2 Implement an internal transactional credit/debit interface. Enforce
  no-overspend with database locking/conditional updates and consistent lock order.
  A cached/read balance must never authorize spending.
- W1.3 Store source provenance, policy version and correlation references. Correct
  errors through linked adjustment entries; never edit historical entries.
- W1.4 Add account-owned wallet/history APIs with bounded pagination and stable
  ordering. Distinguish unavailable state from a genuine zero balance.
- W1.5 Add an audit command that rebuilds/reconciles balance projections from
  entries without issuing currency or silently repairing discrepancies.

Acceptance: real-PostgreSQL tests prove isolation, concurrent debits, integer
bounds, duplicate business operations and ledger reconstruction. No public
arbitrary-credit endpoint. Independent persistence/security review required.

### M2 — Settle verified completion facts

- W2.1 Associate a settlement record with inbox event identity and run/life identity;
  record pending, committed, ineligible or actionable failure and policy version.
  Receipt delivery acknowledgment follows durable inbox acceptance, independent
  of eventual reward settlement.
- W2.2 Implement approved eligibility/rates/caps as deterministic policy functions
  with authored policy fixtures. Reject unsupported versions safely.
- W2.3 Process accepted facts through a bounded restart-safe worker. Atomically
  commit settlement, ledger credit and cap usage; recover work after crashes.
- W2.4 Serialize account/cap updates correctly across concurrent workers. Implement
  the approved delayed/out-of-order event rule rather than relying on arrival order.
- W2.5 Expose per-completion settlement status so verified pickup counts, pending
  credit and spendable balances cannot be confused.
- W2.6 Implement gated activation/backfill according to G2, with dry-run counts,
  audit output and explicit operator authorization before historical credits.

Acceptance: duplicate IDs and new IDs for the same run/life credit once; crash
before/after commit and lost responses do not double-credit; cap boundaries,
ineligible facts, unknown policy and out-of-order facts have documented outcomes.
Existing facts cannot unexpectedly become currency upon deployment.

### M3 — Catalog, owned inventory and equipment

- I3.1 Add stable server catalog IDs mapped to existing cosmetic renderer IDs,
  item type, localized metadata, asset references and sale/availability versions.
  Keep prices on offers; never infer ownership from bundled client assets.
- I3.2 Add unique account/item entitlements with grant provenance. Apply approved
  starter grants idempotently to new and existing eligible accounts.
- I3.3 Add paginated inventory/catalog reads and account equipment read/write APIs.
  Validate ownership, item type and account identity on every equip operation.
- I3.4 Version equipment updates to detect stale cross-device writes; return current
  state on conflict. Define safe rendering fallback for missing assets and preserve
  owned inventory when an offer is delisted.
- I3.5 Load account equipment into the existing wardrobe/renderer with preview,
  explicit Apply and cancel semantics; keep practice preferences separate.

Acceptance: unowned/wrong-type items cannot be equipped; duplicate starter grants
have one effect; reload and another device recover ownership/equipment. Missing
art falls back without changing physics or losing ownership. Independent ownership
review required.

### M4 — Quotes and atomic cosmetic purchases

- S4.1 Persist server-owned, account-bound quotes containing item/offer/version,
  integer amount, currency, expiry and eligibility. Client price claims cannot
  authorize debits.
- S4.2 Add authenticated purchase requests with an idempotency key and canonical
  request fingerprint. Same key/body returns the original operation; conflicting
  reuse fails explicitly.
- S4.3 In one Economy transaction revalidate quote/eligibility/ownership, lock the
  wallet, debit the ledger, grant the entitlement and persist the purchase result.
  Serialize competing purchases and enforce unique permanent ownership.
- S4.4 Add account-owned purchase lookup/list APIs. Persist the committed outcome
  so response loss can recover the same purchase without another debit.
- S4.5 Return stable errors for insufficient funds, expired/stale quote, already
  owned, unavailable offer, ineligible account and idempotency conflict. Never
  silently accept a changed price; require a new visible quote.
- S4.6 Keep purchase separate from equip initially. A successful purchase owns the
  item; the user may then apply it through the wardrobe.

Acceptance: simultaneous buys for the same item create one debit/grant; buys for
different items cannot overspend. Replay after response loss returns the committed
result. Expiry/version races and crash injection preserve all-or-nothing effects.
Independent transaction/security review required.

### M5 — Bilingual wallet/shop user experience

- U5.1 Add account balance and settlement states: loading, ready, pending credit,
  unavailable and reauthentication. Label in-game Stars distinctly from XTR.
- U5.2 Add skin/background catalog browsing, preview, visible price/currency,
  owned/equipped indicators and insufficient-funds explanation.
- U5.3 Present purchase confirmation with the exact quoted item/price. Define
  accessible keyboard/touch flow, focus recovery and localized count/error text.
- U5.4 Retain pending purchase identity by account before sending. Disable duplicate
  submission locally, but rely on server idempotency for correctness. Recover
  uncertain outcomes by lookup/retry of the same operation after reload/login.
- U5.5 Fence old account/session responses; never show one account's wallet,
  inventory or pending operation in another account. Clear scoped UI on logout.
- U5.6 During service failure allow browsing cached presentation with clear stale
  status, but require server confirmation for purchases/equips. Preserve gameplay
  pause behavior; a shop interaction must not also flap.
- U5.7 Add frontend behavior tests for all operation states, storage failure,
  account switches, stale quote refresh and recovery after lost responses.

Acceptance: RU/EN users can inspect, confirm, buy and equip; pending credit is
never presented as spendable. Storage failure cannot cause automatic creation of
a new purchase while the old outcome is unknown. Browser suites remain explicitly
requested checks; physical Telegram acceptance is separate.

### M6 — Integration, capacity and operational acceptance

- V6.1 Test end-to-end verified completion → inbox → settlement → wallet → quote →
  purchase → inventory → equip → reload/second-device recovery against real DBs.
- V6.2 Inject crashes before/after each relevant commit/acknowledgment; test receipt
  and purchase replay, expired authentication, cross-account access, duplicate
  keys, concurrent spending and stale equipment versions.
- V6.3 Complete one batched independent milestone review; return consolidated
  findings to the implementation owner. Rerun affected checks after revisions.
- V6.4 Run final routine checks plus Python/Core/real-PostgreSQL integration checks
  relevant to changed paths. Verify migrations on populated data and rollback
  strategy; never roll back by deleting financial records.
- V6.5 Freeze the tested revision. Measure settlement throughput and mixed gameplay,
  wallet, catalog and purchase traffic. Agree realistic purchase/read rates and
  latency thresholds before running; do not assume 1,000 players buy every second.
  Verify no gameplay regression, overspend, lost committed orders or growing backlog.
- V6.6 Add alerts/runbooks for settlement age, ledger mismatch, unknown purchase
  outcomes, transaction failures and connection saturation. Exercise flag shutdown,
  restoration and safe replay.
- V6.7 Conduct requested browser checks and real Telegram RU/EN acceptance. Hosted
  redundant instances, synchronous database failover, restore drills and rollout
  require the separate provider/budget/deployment approval gate.

Acceptance: evidence names revision, environment and checks. Long jobs have bounded
duration, saved output and collection commands; return control rather than polling.
SHOP activation requires the accepted gates, not merely merged code.

## Proposed persistence and contract boundaries

| Module | Records / operations |
| --- | --- |
| Wallet | Wallet/currency, immutable entries, balance projection, audit |
| Settlement | Policy versions, fact settlement, cap usage, processing leases |
| Inventory | Entitlements, grant provenance, equipment revision |
| Shop | Catalog/offer versions, account quotes, purchase result and idempotency |
| Existing inbox | Immutable verified facts; retained regardless of issuance state |

Proposed browser API families under a versioned Economy prefix: wallet and ledger
history, completion settlement lookup, catalog/quotes, purchases and purchase lookup,
inventory and equipment. Freeze exact schemas in M0; this document does not create
routes. Economy authorization uses validated identity without querying Platform's
database. Core needs no change unless contract review identifies missing evidence;
any shared event change requires compatibility/versioning review first.

## Execution sequence and definition of done

Default sequence: M0 → M1 → M2 → M3 → M4 → M5 → M6.
UI contract prototypes may overlap after M0, but use one implementation worker by
default and avoid simultaneous edits to shared API/models. No separate test-writing
agent. Main agent owns branches, integration and commits; implementation stays with
Luna under root instructions.

For each milestone: settle acceptance → worker TDD/self-review → main review →
batched independent review when required → focused revisions → coherent commit.
Run full suites at integration milestones, not after every small edit.

Done means an eligible verified run credits exactly once under an approved policy;
the account can buy an approved cosmetic once, with no overspend or partial grant;
ownership/equipment survive reload/device changes; uncertain operations recover;
practice and gameplay remain intact; release evidence and open external gates are
reported accurately.

Related: [development plan](DEVELOPMENT_PLAN.md),
[economy policy](MVP_SPECIFICATIONS.md#3-initial-economy-catalog-and-payment-policy),
[architecture](ADR-001-MICROSERVICES.md), [backend evidence](BACKEND_FOUNDATION.md).

## Telegram identity and payment eligibility research

Checked official documentation October 17, 2026. Backend-validated
[Mini App initialization](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
establishes authenticated Telegram identity and freshness, not unique humanity,
age or ability to pay. The documented Bot API User fields have no general payment
eligibility flag; [getMyStarBalance](https://core.telegram.org/bots/api#getmystarbalance)
returns the bot balance. MTProto
[payments.getStarsStatus](https://core.telegram.org/method/payments.getStarsStatus)
is documented for user clients, not a bot querying arbitrary players.
Conclusion: do not introduce an assumed “can donate” verification API.

[Telegram digital-goods payments](https://core.telegram.org/bots/payments-stars)
use XTR invoices, pre-checkout validation and a successful-payment update before
fulfillment; a frontend invoice-close event alone cannot authorize credit.
Users may acquire Stars during checkout. Telegram Premium status does not
establish ability to pay. Regional/payment restrictions can still affect checkout.

Owner-approved eligibility: authenticated Telegram accounts may earn
and spend verified gameplay Stars without prior payment or extra tasks.
Only purchased funding requires validated successful payment. This keeps free
play available without claiming that every authenticated account can transact.
The 1:1 funding denomination does not imply developer cash proceeds equal the
consumer's purchase price; digital-goods funding remains the separate PAY phase.

## Approved initial catalog

| Category | Item | Price |
| --- | --- | --- |
| Skin | Classic | Free default |
| Skin | Mint | 20 coins |
| Skin | Rose | 200 coins |
| Skin | Celestial | 100 in-game Stars |
| Skin | Royal | 200 in-game Stars |
| Background/map | Meadow | Free default |
| Background/map | Dusk | 20 coins |
| Background/map | Winter | 200 coins |
| Background/map | Nebula | 100 in-game Stars |
| Background/map | Aurora | 200 in-game Stars |

The owner approved these offers during implementation. Stable server IDs and
versioned quote schemas remain engineering work. Existing Classic/Mint/Rose and
Meadow/Dusk/Winter renderer IDs must remain compatible. No XTR offer or currency
purchase is enabled by this approval.

## Implementation evidence — October 17, 2026

- Recovery prerequisite: bounded authenticated Core admission implemented and
  committed as d42a0aa. Real PostgreSQL/race/vet and routine checks passed;
  independent review found no actionable issues. The earlier outage run was
  intentionally interrupted by the owner stopping Docker. A complete rerun is
  still required; no new unattended run has been launched.
- W1.1–W1.3 and reconciliation portion of W1.5: internal wallet schema and posting
  primitives implemented. Immutable ledger, provenance, transactional projection,
  replay/conflict handling, no-overspend and read-only audit are present.
- Real PostgreSQL TDD: initial nine tests failed for missing behavior, then passed.
  Review added stale cached-balance and bounded-audit regressions; both reproduced
  findings before correction. Final complete Python PostgreSQL suite passed 22
  tests, including twelve wallet tests. Independent review and targeted re-review
  completed without remaining actionable findings.
- The authenticated wallet/history API (W1.4), an operator audit command, settlement,
  policy activation/backfill, inventory, equipment, catalog and purchase behavior
  are not implemented by this milestone. No existing run facts have been credited.
- New Star generation requires its separate shared-simulation implementation.
  Browser, real Telegram and hosted acceptance remain separate.

## Settlement contract settled before implementation

Wallet and ledger API amounts use decimal strings to preserve signed-64-bit
precision in browsers. Reads scope solely to authenticated identity and fail as
unavailable on database errors rather than showing a fabricated zero balance.
Current identity tokens remain compatible with Core and Platform authentication.

Completion receipt acknowledgment follows durable inbox acceptance, independently
of settlement processing. A bounded operator worker commits settlement, ledger
credit and per-run coin cap usage together. Life indices process in order; a
future out-of-order life waits for predecessors rather than consuming cap by
delivery order. Continue itself is not implemented.

Issuance defaults disabled and requires an explicit UTC activation cutoff.
Historical verified facts are eligible for explicit dry-run/backfill of coins
only. No backfill executes automatically during migration or startup. Existing
simulation tuple 1.3.0/1.2.0/dd-v1-stepped-v1 earns only coins under the initial
policy; its earlier Star generation must not silently fund premium currency.
The approved new generation tuple will be added explicitly after its separate
simulation implementation. Unknown identities require action rather than credit.

### Wallet API and settlement milestone

Implemented authenticated decimal-string balances/history and own-completion
settlement status; migration 0003, pending inbox settlement, bounded processing,
once-only coin credits with a 30/run cap, explicit historical coin backfill,
paged dry-run and supported-failure requeue. Legacy Stars remain uncredited.
Settings default disabled with a required explicit activation cutoff before work.

Real PostgreSQL suite: 39 passed. Native Python formatting/lint, strict mypy and
six non-database tests passed; its 33 DB skips are separate from the complete
container execution. Independent review/re-review resolved cap caching, readiness
starvation, malformed cursors and operator recovery. Corrected fixture identities
were checked against temporarily restored old ordering/paging to prove intended
regressions before the final passing run. No actual retained player facts were
credited; all database tests used dedicated test databases.

Backfill dry-run pages are estimates against current committed state, not one
cross-page snapshot. Use the returned cursor and re-plan after applying a page;
do not add page estimates blindly when one run spans page boundaries.
