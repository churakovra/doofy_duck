# Development plan toward the first public release

Prepared October 15, 2026, after the foundation refactor. This is a proposed
implementation sequence, not approval of prices, economics, infrastructure
deployment, or unresolved game mechanics.

Authority: [Product vision](PRODUCT_VISION.md) defines requirements;
[ADR-001](ADR-001-MICROSERVICES.md), [ADR-002](ADR-002-CLIENT-AND-REWARDS.md), and
[ADR-003](ADR-003-CURRENCY-AND-BROKER.md) define selected technical directions
and proposals. [Foundation](FOUNDATION.md) describes current extension boundaries.

## Requirement coverage today

| First-release requirement | Current state | Remaining work |
| --- | --- | --- |
| Single-tap flight, scoring, free new runs | Implemented locally | Telegram/device acceptance and gameplay tuning |
| Varied, stepped, fair challenges with recovery | Seeded gaps and speed ramp | Challenge design, stepped generator, reachability evidence, playtesting |
| Telegram Mini App and saved player progress | Browser game and untrusted local storage | Telegram integration, identity, authoritative services and persistence |
| Coins and in-game Stars, separate from XTR | `FEATHER`/`GAME_STAR` local balances | Product wording, approved issuance policy, authoritative ledger |
| Owned/equipped skins and backgrounds | Renderer palette boundary | Catalog, assets, inventory, equip, shop and purchase transactions |
| Actual Telegram Stars purchases | Not implemented | Product/pricing decisions, provider integration, fulfillment and refunds |
| At most one paid continue preserving score | Death is terminal | Lifecycle design, safe resume, authorization and accounting |
| Russian and English | Russian catalog with some mixed wording | Typed bilingual catalogs, locale selection and complete UI coverage |
| Operational and abuse protection | Local validation and simulation parity | Service authorization, limits, detection, monitoring and recovery |

## Delivery sequence

Each milestone needs a short behavior specification, failing tests first,
implementation, relevant checks, and independent review. Keep each feature on
its own branch. Do not wait until the final milestone to integrate the services.

### 0. Resolve requirements that affect contracts

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
  RabbitMQ is currently a recommendation, not a completed decision.

Acceptance: decisions have owners and explicit acceptance rules; unresolved
items stay visible and block only their dependent work. Translations, gameplay
experiments, and contract drafts can proceed in parallel. Provider-dependent
implementation must recheck official provider documentation at that time.

### 1. Align the playable client with the product language

Implement typed Russian/English message catalogs, locale selection and saved
preference. Use “coins” and “in-game Stars” consistently in player-facing text;
retain existing simulation IDs and local storage schemas. Keep XTR visibly
separate. Translate errors, controls, accessibility labels, and currency plurals.
Keep local-practice labels accurate until account progress exists.

Acceptance: every player-facing message has both translations, switching locale
preserves the current run, and no wording implies withdrawals or live gifts.

### 2. Build the approved challenge system

Replace the current gap/ramp-only progression with the specified stepped
challenges in TypeScript and Go. Keep generation seeded and bounded, include
recovery sections, and pin the rules/generator/configuration for each run.
Purchases and balances must never influence difficulty.

Acceptance: semantic tests and reviewed fixtures agree across both languages;
transition checks use actual flight dynamics and reaction constraints;
representative sequences have recorded feasibility evidence. A controller
surviving one seed is insufficient evidence for all generated transitions.
Owner playtests assess challenge, variety, and recovery before tuning is frozen.

### 3. Prototype the cosmetic experience

Add stable catalog IDs, skin/background definitions, asset loading, equipment
preview, and selection screens using the renderer boundary. Establish the final
visual direction before producing the full asset catalog. Development inventory
may use explicit test data; it cannot become proof of commercial ownership.
Product quotes/prices remain provisional until the economy specification exists.

Acceptance: changing appearance leaves hitboxes, rules identity, scoring and
replay outcomes unchanged; missing assets have a usable fallback. The flow is
usable in both languages. Account ownership/purchases arrive in milestone 6.

### 4. Establish Telegram identity and service contracts

Implement the selected Platform (Python), Core (Go), and Economy (Python)
boundaries behind one public origin. Start with an authenticated end-to-end
service skeleton, versioned HTTP/event contracts, service-owned database
migrations/credentials, and reproducible local startup. Add the chosen broker
when implementing durable delivery, with transactional outbox/inbox handling.

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
Persist evidence/outbox atomically in Core; deduplicate event and business
identities in Economy. Show pending credit during outages. Keep local practice
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

- Milestone 1 can start immediately. Milestones 2 and 3 can progress in parallel
  once their focused design decisions exist.
- Milestone 4 contract design can overlap local gameplay/art work. Milestone 5
  depends on identity, durable services and the run/economy specifications.
- Milestone 6 depends on authoritative account progress. Milestone 7 depends on
  the designed lifecycle and authoritative debit/resume workflow.
- Milestone 8 can overlap later shop/continue work after catalog, order and
  accounting contracts stabilize. Milestone 9 includes all release gates;
  operational work begins alongside the first backend slice.

## Recommended next work

Start with **bilingual product wording and locale selection** as a complete,
low-dependency feature. In parallel, prepare the **challenge-generation** and
**run/continue/settlement** specifications. Then implement stepped challenges and
the first authenticated verified-run-to-wallet slice. These close the largest
product gaps and prevent later shop/continue work from inventing incompatible
accounting or lifecycle rules.

## Deliberately after the first public release

Gifts/redemption, loot boxes, leaderboards, friend invitations/challenges,
magnets, abilities and starting boosters stay outside this release. Daily routes
remain unconfirmed. A player-facing statistics feature is not currently required;
add it only after specifying its metrics and authoritative settlement behavior.
Operational/pilot measurements still belong in release work. Later gifts require
their own funded rules, eligibility, delivery/reconciliation and acceptance plan.
