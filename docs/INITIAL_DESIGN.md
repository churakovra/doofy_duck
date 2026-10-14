# Doofy Duck — feasibility, architecture, and delivery proposal

Research checked: October 9, 2026. Status: initial proposal, retained as historical context.

**Architecture update:** The owner has selected Python/Go microservices and retained the frontend stack. `ADR-001-MICROSERVICES.md` supersedes this document's backend stack, monolith recommendation, shared TypeScript engine assumption, and cross-domain single-database transaction design. Its service boundaries and tool choices remain proposed. Economy/payout and other unapproved product choices below are still unresolved.

## 1. Executive decision

**Go for the arcade-game experiment. No-go for promising arbitrary Telegram Stars withdrawals until a supported payout route is demonstrated and approved.**

A duck that falls under gravity, rises on one tap, dodges procedurally generated obstacles, and collects objects is a bounded technical project. Whether it can produce worthwhile profit is unvalidated: we have no observed retention, payer conversion, acquisition cost, fraud rate, or player demand. These are hypotheses, not market facts.

Recommended first product: free unlimited play, earned non-withdrawable **feathers**, progression and cosmetics, with selected cosmetics purchased directly using Telegram Stars. This changes the original earning proposition and requires the owner's approval. If withdrawals are essential, resolve that feasibility question before proceeding with this MVP.

The final “3.” in the initial request is ambiguous. This document emphasizes system design while covering the research, stack, and quality pipeline needed to support it.

## 2. Platform findings and economic constraints

### Verified platform facts

- Digital goods and services sold inside Telegram bots/Mini Apps must use Telegram Stars, currency `XTR`. A cryptocurrency checkout is not an alternative for these sales.[1]
- The current Bot API offers payment refunds, bot-balance/transaction inspection, gifts, and business-account integrations. Inspection of its documented methods found **no general arbitrary bot-to-user Stars payout method**. This is a finding about the documented API, not a claim that every possible Telegram mechanism is impossible.[5]
- `refundStarPayment` requires the original user's payment charge identifier. It reverses a successful payment; it is not a way to mint or pay gameplay winnings. `transferBusinessAccountStars` moves Stars from a connected business account into the bot, not from a bot into a player's personal balance. `sendGift` explicitly says its recipient cannot convert the gift to Stars.[5]
- Telegram separates personal Star balances from creator/developer balances; its personal-balance terms restrict selling, withdrawing, transferring, and other uses outside explicitly allowed purposes. Do not interpret this as a blanket prohibition on every creator reward mechanism.[3]
- The developer terms currently list a reward equivalent of USD 0.013 per Star, while allowing Telegram to change the value. Availability can be delayed up to 21 days, and Fragment rewards may not be available to every operator or country. Enabling private-chat topics currently introduces a 15% non-refundable deduction on subsequent Star purchases; leave that feature disabled unless needed and modeled.[4]
- Payment fulfillment must wait for `successful_payment`, not a client invoice callback or merely pre-checkout approval. Telegram provides a dedicated test environment for Star payments and requires purchase support, including `/paysupport`.[1]
- Telegram instructs servers to validate raw `initData` and not trust `initDataUnsafe`.[2]

### Consequences — design judgments, not platform rules

1. Keep actual Telegram Stars, earned feathers, and any future prize claims separate. A database counter named `stars` does not represent Stars in a user's Telegram account.
2. An in-game reward that can be redeemed creates an obligation that must be funded. Spending previously awarded rewards inside the game can reduce that obligation; it does not create new external revenue.
3. Free play plus unlimited withdrawable accrual exposes an unlimited budget. If a future prize model is approved, apply a pre-funded prize pool, disclosed eligibility and earning limits, and a reserve policy **before** awarding redeemable value. Infinite gameplay can remain; rewards need not be infinite.
4. A withdrawal minimum does not solve an underfunded economy. Never make withdrawal conditional on donating or buying something.
5. Do not rely on user-account automation, disguised refunds, paid-message loops, or gifts as an unreviewed payout workaround. A supported alternative must be independently validated, costed, and disclosed.
6. Do not launch paid loot boxes or paid advantages that increase redeemable earnings in the MVP. Obtain qualified review for the operator's and players' jurisdictions before adding monetary prizes or paid chance-based mechanics. Apple explicitly requires disclosure of odds for purchasable randomized items and places additional restrictions on real-money gaming; disclosure alone is not legal or platform approval.[15]
7. Make the product enjoyable without an earnings claim. If users stop returning when rewards disappear, we have not validated the game business.

### Illustrative arithmetic, not a forecast

Using the currently published baseline reward rate, before conditional deductions and all other costs:[4]

| Hypothetical input | Value |
| --- | --- |
| Daily active players | 1,000 |
| Players paying on a particular day | 2% |
| Stars spent per paying player that day | 100 |
| Gross Stars received that day | 2,000 |
| Gross developer reward equivalent that day | USD 26 |
| Gross equivalent across 30 identical days | USD 780 |

These outputs were calculated with decimal arithmetic. The daily payer assumption is not a monthly conversion rate or an industry benchmark. Acquisition, refunds, prizes, infrastructure, support, taxes, exchange costs, and any platform deductions remain to be paid.

```text
Contribution = realizable developer receipts
             - refunds and payment deductions
             - funded player prizes, if any
             - acquisition
             - variable infrastructure and support

Operating profit = contribution - fixed operating costs
```

Model cash availability separately from contribution: unsettled Star revenue is not cash available to fund prizes today. Do not count feathers spent as external receipts.

## 3. Product requirements and proposed boundaries

### MVP acceptance criteria

- One tap applies one upward impulse; gravity resumes immediately. Pointer events avoid duplicate touch/click impulses. Desktop keyboard input is an optional accessibility aid.
- A round has no designed end while the duck is alive. Obstacles and collectibles are generated incrementally, not as a finite prebuilt map.
- Collision with an obstacle, floor, or ceiling ends the round. Boundary collisions are a proposed rule requiring approval.
- A collectible is granted once when the duck enters its documented pickup radius. A death on the same simulation tick takes precedence over collecting an object on that tick.
- Procedural generation respects a feasible flight envelope and tested obstacle-gap limits; randomness must not create unavoidable obstacle sequences.
- World objects, input buffers, and server verification work remain bounded over long runs.
- Earnings from verified completed segments are retained on death. Unverified client counts are displayed as pending and never added to a durable balance.
- Backgrounding pauses the simulation. Reconnect/resume follows a documented policy; offline/practice play cannot manufacture account rewards.
- A user has at most one reward-bearing active run. Parallel tabs and stale requests cannot double-credit it.
- Cosmetics do not change the physics or collision box. If assistance is later added, assisted and unassisted leaderboards are separate.
- The wallet labels feathers as non-withdrawable and never claims they are Telegram Stars. There is no withdrawal button in this proposed MVP.
- Purchases, entitlements, and legitimate refunds are durable and explainable to support.

### Include

Game loop, tutorial, endless procedural world, feathers, restart, personal best, a simple leaderboard, a small cosmetic catalog, Star purchases, inventory/equip, payment support, operational dashboard, and basic event analytics.

### Defer

Withdrawals, paid random boxes, earning multipliers, tradable inventory, cryptocurrency, referral payouts, marketplace, multiplayer, subscriptions, and numerous independently deployed services.

## 4. Proposed stack

| Layer | Choice | Reason for this project |
| --- | --- | --- |
| Language | TypeScript, strict mode | Share deterministic game rules between browser and server; one agent/tooling language |
| Build/runtime | pnpm workspace; Vite; supported Node.js LTS pinned at implementation | Reproducible builds without introducing a large monorepo framework |
| Game renderer | PixiJS | Keep rendering separate from testable physics; its official quick start supports a Vite setup[8] |
| App shell | React | Store, wallet, profile, settings; not the per-frame simulation |
| Backend | Fastify | Small HTTP boundary; built-in request injection supports API testing[10] |
| Telegram adapter | grammY | TypeScript bot integration on Node.js[11] |
| Database | PostgreSQL; explicit SQL migrations and parameterized queries | Transactions, uniqueness, concurrency control, ledger, outbox |
| Jobs | PostgreSQL transactional outbox + worker | Avoid introducing Redis/Kafka as MVP prerequisites |
| Testing | Vitest; fast-check; Playwright; real PostgreSQL integration tests | Unit/property/integration/browser layers; Vitest provides coverage reporting[14] |
| Delivery | Docker; GitHub Actions if GitHub is chosen; static hosting/CDN; managed PostgreSQL | A small deployment footprint |
| Operations | Structured logs, metrics, error reporting, automated backups | Detect money/auth failures and restore durable state |

These are recommendations, not a benchmark-backed winner or locked dependency versions. Pin and verify compatible versions when scaffolding. React is optional if the surrounding UI stays very small; a custom Canvas renderer is an alternative to PixiJS. Phaser becomes worth reconsidering if the project evolves into a much broader game, but keep simulation independent of any rendering library.

Start with a **modular monolith**, not microservices. Scale the game-verification worker independently only if measurements require it.

## 5. System architecture

```text
Telegram client
    | launches
    v
Mini App: React shell + PixiJS renderer
    | HTTPS: validated auth, run inputs, purchases
    v
Fastify API + grammY webhook adapter
    | modules: identity, runs, economy, store, payments, inventory, ranking
    v
PostgreSQL: authoritative records + append-only ledger + transactional outbox
    |                                  |
    v                                  v
Worker: verification/reconciliation     Analytics / operational alerts
    |
    v
Telegram Bot API
```

Static assets are served separately from the API. Never put the bot token in the browser. The rendering loop makes no per-tap network round trip.

### Module responsibilities

| Module | Owns | Does not own |
| --- | --- | --- |
| Identity | Validated Telegram identity, application sessions, consent | Gameplay trust or uniqueness of a real human |
| Game core | Gravity, impulses, collisions, PRNG, obstacle generation, pickup rules | Rendering, Telegram, database access |
| Runs | Run lifecycle, input sequences, snapshots, server verification | Client-submitted reward totals |
| Economy | Feather ledger, earning policies, reservations where needed | Actual external Star balances |
| Payments | Orders, invoice mapping, Telegram payment/refund facts | Client claims that an invoice was paid |
| Store/inventory | Catalog, grants, ownership, equip/revoke | Direct balance edits |
| Ranking | Verified score projections and fairness categories | Source-of-truth wallet state |
| Operations | Reconciliation, incident response, audit, kill switches | Undocumented admin balance mutations |

### Run verification protocol

1. Start an authenticated run. The server stores the user, unique run ID, generator seed, engine/config version, initial state, loadout, and reward-policy version.
2. A pure game-core package runs locally at a fixed simulation step. Rendering interpolates independently. Use specified integer/fixed-point units, an explicit PRNG, stable ordering, and shared golden vectors to verify browser/Node parity.
3. The client sends bounded, sequence-numbered batches of tap ticks. The server continues simulation from its **own last accepted snapshot**, not a client snapshot, and checks ownership, sequence, wall-clock plausibility, allowed input rate, and payload limits.
4. The server atomically persists the next verified state and any collectible ledger entries. An idempotency key makes retries return the prior result. Unique run/object reward keys prevent duplicates.
5. Finalization marks death and score exactly once. Obsolete or post-death inputs cannot reopen the run.
6. Snapshot and compact accepted prefixes. Rebase world coordinates and recycle objects so infinite rounds do not imply infinite memory or repeated replay of the full history. Keep a bounded audit window and immutable financial facts; retention policy determines nonfinancial replay retention.
7. A provisional offline run can continue as practice, but rewards wait for valid segments. Exceeding a documented reconnect allowance cannot silently discard already verified earnings.

**Security limit:** replay validation proves that an input sequence obeys the game, not that a human generated it. Public seeds and a shared engine make automated optimal play possible. One Telegram ID is not one person. A redeemable-prize version therefore needs a separate abuse model, funded reward caps, risk review, and potentially rolling server-issued world segments. Do not market deterministic replay as bot-proof.

### Authentication and payment flow

- Validate signed raw Telegram `initData` on the server, including an accepted authentication age; issue a short-lived application session. Raw initialization data and tokens must not appear in logs.[2]
- Authorize every run, order, and inventory operation against that session. Server-side catalog prices and eligibility are authoritative.
- Authenticate Telegram webhooks, validate payloads, persist updates idempotently, and meet the pre-checkout response deadline. Do not leave pre-checkout behind a slow general-purpose queue.[1]
- Create an order with explicit user, item, price, currency, and opaque invoice payload. Validate user/payload/amount/currency at pre-checkout and again at payment receipt.
- Grant an item only after a server-side `successful_payment` fact has been recorded. Store the charge ID with a unique constraint; duplicate delivery of the same payment cannot grant twice.[1]
- An order must also prevent distinct payments from accidentally granting a supposedly single-purchase entitlement multiple times; explicitly handle late or duplicate paid orders and refund where appropriate.
- Refund processing is an asynchronous state machine. A timeout leaves an **unknown/reconciling** outcome, not automatic success or automatic release. Append reversals and revoke refundable entitlements; never erase payment history. Telegram documents both refund and transaction-inspection methods.[5]

### Durable data and invariants

Proposed tables: `users`, `sessions`, `runs`, `run_checkpoints`, `reward_events`, `ledger_transactions`, `ledger_entries`, `catalog_items`, `orders`, `payments`, `refunds`, `inventory`, `telegram_updates`, `outbox`, `audit_events`.

- Ledger amounts use integral units with currency/type explicit; payment IDs remain exact strings and Telegram IDs use a safe representation.
- Every ledger transaction balances within its own currency. PostgreSQL enforcement must prevent unbalanced postings; application validation alone is insufficient.
- A reward event credits once, a Telegram charge fulfills once, and an inventory grant has an explicit unique source.
- Concurrent spending cannot produce an unauthorized negative available balance; lock or atomically condition relevant account updates.
- Source-of-truth ledger entries are immutable; corrections are linked compensating transactions. A cached balance is transactionally maintained or rebuilt and reconciled.
- Actual Star receipts and operator funds are not interchangeable with feather issuance. Any future monetary liability has its own accounting unit and reconciliation.
- Domain updates and outbox events commit together. Consumers are idempotent; external calls are not magically exactly-once.
- Administrative grants/refunds require authenticated privileged access, a reason, and an audit event.

### API sketch

```text
POST /auth/telegram
GET  /me
POST /runs
POST /runs/:id/checkpoints
POST /runs/:id/finalize
GET  /wallet
GET  /catalog
POST /orders
GET  /orders/:id
GET  /inventory
POST /inventory/:id/equip
GET  /leaderboard
POST /telegram/webhook
```

No public “credit balance” endpoint. No withdrawal endpoint until a supported payout design is approved. Use a documented error contract, explicit limits, server authorization, and idempotency semantics for mutating requests.

### Operations and privacy

Separate development, Telegram test, staging, and production credentials/databases. Back up PostgreSQL and exercise restoration. Retain financial audit data according to a reviewed policy while minimizing profile data. Define deletion/anonymization behavior, consent, age policy, and geographic availability before launch.

Monitor payment-to-fulfillment lag, duplicate events, ledger discrepancies, rejected run segments, checkpoint CPU/time, crash rate, outbox age, conversion, retention cohorts, and actual acquisition/prize cost. Alert on any unexplained ledger discrepancy. A purchase kill switch must not prevent processing already-paid orders or legitimate refunds.

Candidate performance goals must be measured on selected real devices: smooth rendering at the target refresh rate, bounded long-run memory, and sufficiently fast checkpoints to avoid a visible pending-reward backlog. These are requirements to establish, not results already achieved.

## 6. Agent development and testing pipeline

### Per-feature contract

1. A human approves a small issue with business behavior, explicit invariants, abuse cases, and acceptance examples.
2. An agent proposes the smallest vertical slice; contracts or schema changes receive review before broad parallel work.
3. **RED:** write one meaningful failing test; run it and retain expected-failure evidence. A missing dependency, syntax error, or absent import is not the behavioral RED evidence we want.
4. **GREEN:** implement the smallest behavior; run the focused test and relevant regression suite.
5. **REFACTOR:** simplify with tests still green. Repeat the cycle for the next behavior, rather than writing a speculative pile of tests and then a large implementation.
6. A fresh reviewer checks requirement compliance, security, race conditions, data consistency, and maintainability. The author cannot self-approve high-risk code.
7. Execute deterministic CI gates; deploy the immutable artifact to staging; execute browser/API checks and Telegram test-environment payment verification; approve release.
8. Record failures as executable regression tests and incident scenarios.

CI passing cannot by itself prove that tests were written first. Preserve concise RED/GREEN command evidence in each PR. Agents may not weaken tests, blanket-update snapshots, suppress warnings, or change earning/payment rules merely to make a build green.

### Test pyramid and non-negotiable scenarios

- **Game unit/property tests:** gravity and tap response; death/pickup ordering; each object collected once; feasible obstacle sequences; specified PRNG; browser/Node golden-vector parity; long-run bounded object counts; coordinate rebasing; pause semantics.
- **Real PostgreSQL integration tests:** two simultaneous spends cannot overspend; duplicate rewards/payments/webhooks are harmless; checkpoint persistence and reward credit are atomic; outbox recovery; balanced ledger enforcement; refund reversal; migration from the prior schema.
- **API/auth tests:** forged/expired initialization data; wrong run owner; stale sequences; huge payloads; unreasonable elapsed time; replayed requests; invalid price/currency/user; privilege checks.
- **Failure-injection tests:** timeout after a remote action but before acknowledgment; crash between ledger and notification; reordered Telegram updates; worker retry; delayed payment; network loss; reconciliation after an ambiguous refund.
- **Browser tests:** touch and keyboard behavior; restart; Telegram SDK boundary using explicitly marked fixtures; shop/equip; pending purchase; interrupted network; resize/safe areas/backgrounding. Playwright can emulate viewport and touch behavior, but that is not proof of behavior inside real Telegram WebViews.[12]
- **Real Telegram checks:** separate test-environment bot and payment flow; selected iOS/Android/Desktop clients; invoice UX and viewport/lifecycle behavior. Automate what is reproducible, retain a short release smoke checklist for what is not.
- **Mutation tests:** critical ledger, auth, and reward decisions must have assertions that catch intentional logic mutations, not just high line coverage.

### Proposed CI gates

Format/lint → strict typecheck → unit/property tests → real-DB integration and migrations → production build → browser tests → secret/dependency scans → independent review → staging → provider contract/smoke verification → protected production promotion.

Pin dependencies and CI actions; retain logs/traces and the tested build digest. For auth/payment/ledger changes, required checks fail closed. Do not grant deployment/payment secrets to untrusted fork code or scenario-generation tools. Treat flaky reruns as a defect to investigate, not evidence equivalent to a first-run pass. Use backward-compatible migrations and test rollback/restore procedures before launch.

### QAless integration: researched, not installed or executed

Assumption: “qaless” refers to QAless at `qaless.vercel.app`. Confirm this with the owner.

Its README describes scenario generation and Playwright/Postman/Markdown exports; it explicitly distinguishes generation from test execution. Use it to propose missing scenarios, review and implement them, and feed confirmed incidents back into the scenario history. It is not a substitute for executed assertions or independent review.[17]

There is a packaging mismatch to resolve: the README shows v0.13.0 download instructions and an Ubuntu CI example while also saying Linux is not shipped. The repository's current latest-release API returned v0.12.7, published June 20, 2026, with only macOS ARM64 and Windows AMD64 binaries plus a checksum file. Do not copy those installation/Ubuntu instructions into CI unverified.[17][18]

Proposed path: keep the core test pipeline portable; trial QAless on a supported isolated runner with a pinned, verified artifact. Keep it advisory until actual commands, export completeness, behavior, licensing, CI support, and source-data exposure are evaluated. Code fragments may be sent to the configured LLM provider; “local-first” should not be read as “nothing ever leaves the machine.” The README documents provider keys and LLM source-analysis prompts.[17]

Do not install a proprietary binary, purchase a license, provision a self-hosted runner, or send repository content to a new third party without the owner's approval. No QAless binary was found on PATH during this research.

## 7. Validation and delivery order

### Gate A — approve the product/economy

Resolve target countries, age policy, whether withdrawals are indispensable, what payout asset is actually required, reward funding, and whether the feather MVP is acceptable. If Stars-to-personal-balance withdrawal is indispensable, obtain a documented supported route and demonstrate it before advertising earning potential.

### Gate B — test demand without payout promises

Acquire a small identifiable test cohort, without presenting hypothetical profit as an outcome. Observe tutorial completion, replay rate, return cohorts, run length, failures, and purchase intent; then test actual cosmetic conversion. Distinguish incentivized users from users attracted by the game itself. Define continue/stop thresholds against the owner's budget and observed costs, not copied industry averages.

### Gate C — engineering feasibility

Create targeted experiments only after approval: browser/Node deterministic parity over long seeded runs; smooth gameplay inside real Telegram clients; idempotent Stars purchase/refund in Telegram's test environment. If prizes remain in scope, validate the payout route first. Experiments are disposable; production code follows TDD.

### Gate D — implement vertical slices

1. Tap → gravity → collision → restart, with game-core tests.
2. Seeded endless generation → collectible → long-run tests.
3. Telegram identity → verified run segment → exactly-once feather credit.
4. Inventory → equip cosmetic → unchanged physics.
5. Star invoice → validated payment → single entitlement → refund.
6. Leaderboard, telemetry, backups, operational controls, abuse checks.

No end-to-end withdrawal feature is included in this proposed MVP. A future prize architecture requires a separate design and approval, rather than an empty placeholder “withdrawal service.”

## 8. Open decisions

1. Which countries and age groups will the operator and initial players be in?
2. Is withdrawal to a personal Telegram Stars balance essential, or can the first release use feathers and optional cosmetics?
3. Does “qaless” mean the product researched above, or a QA-less development process?
4. What are the owner's preferred backend language, weekly time budget, infrastructure budget, and initial distribution channels?
5. Which launch choices—boundary death, pause/reconnect, assisted play, and catalog—should become acceptance criteria?

## 9. What exists after this research

The project originally contained a one-line `IDEA.md` and empty `doofy_facade`/`doofy_core` directories; it was not a Git repository. This document is the delivered artifact. Application code, deployment, CI execution, Telegram bot configuration, payment transactions, QAless execution, market demand, and profit have **not** been implemented or verified.

## Sources

[1] https://core.telegram.org/bots/payments-stars
[2] https://core.telegram.org/bots/webapps
[3] https://telegram.org/tos/stars
[4] https://telegram.org/tos/bot-developers
[5] https://core.telegram.org/bots/api
[8] https://pixijs.com/8.x/guides/getting-started/quick-start
[10] https://fastify.dev/docs/latest/Guides/Testing
[11] https://grammy.dev/guide/getting-started
[12] https://playwright.dev/docs/emulation
[14] https://vitest.dev/guide/coverage
[15] https://developer.apple.com/app-store/review/guidelines
[17] https://github.com/rwrrioe/qaless-releases
[18] https://api.github.com/repos/rwrrioe/qaless-releases/releases/latest
