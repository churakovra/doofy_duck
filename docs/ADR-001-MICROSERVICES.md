# ADR-001 — Python and Go service architecture

Status: selected future deployment shape: one frontend + Gateway +
Platform/Core/Economy. Detailed tools remain proposals. These services are not
implemented; see [ARCHITECTURE](ARCHITECTURE.md) for the running code and
[Product vision](PRODUCT_VISION.md) for release scope.

## Decision and scope

Platform and Economy use Python; Core uses Go. The frontend uses
TypeScript/React/Vite/PixiJS. The first public release includes purchases and one
optional continue; gift exchange and leaderboards are later features. The ownership
and workflows below describe the future architecture, not current infrastructure.

Recommendation: start with three independently deployable services, not a service for every table or function. Split by data ownership, consistency requirements, and workload. Language is a consequence of a service boundary, not the definition of that boundary. No performance advantage has been measured for this application yet.

## Initial services

| Service | Language / proposed tools | Responsibilities | Authoritative storage |
| --- | --- | --- | --- |
| Platform | Python; FastAPI, Pydantic, aiogram | Telegram webhook and bot commands; validate Mini App initialization; identity/session issuance; Telegram API transport; durable ingress and forwarding | Users, sessions, Telegram update inbox, transport operations, outbox |
| Core | Go; net/http, pgx, sqlc | Run lifecycle; fixed-step simulation; procedural generation; checkpoint verification; abuse limits; verified score and collectible evidence; later leaderboard projection | Runs, checkpoints, verification evidence, score projections, outbox |
| Economy | Python; FastAPI, Pydantic, SQLAlchemy, Alembic | Reward policy; wallet ledger; store/catalog; orders; payment/refund business states; inventory/equip; reconciliation | Reward receipt inbox, accounts, ledger, orders, payments, refunds, inventory, outbox |

Python is a proposed fit for frequently changing product rules and integrations. Go is a proposed fit for the concentrated simulation/verification workload and its profiling/benchmarking needs. Do not translate services into Go merely because their traffic increases: investigate query patterns, locks, queues, CPU, and memory first. Go provides CPU/memory profiling and tracing facilities to investigate actual costs.[5]

FastAPI documents OpenAPI/JSON Schema support and typed validation via Pydantic, which fits the proposed HTTP boundary.[1] aiogram documents asynchronous webhook integration; its built-in server integration is aiohttp, so using it with FastAPI requires an explicit adapter and adapter tests, not copying an aiohttp handler unchanged.[2]

The platform service is a Telegram/identity boundary, not a general-purpose business-logic gateway. A reverse proxy routes authenticated browser traffic to the appropriate service on one public origin. The game does not send every tap through Python or to the network.

## Transaction boundaries

Keep wallet, shop, inventory, and payment business state inside Economy initially. A coin purchase can debit the wallet and grant a cosmetic in one local database transaction. A confirmed payment can record its receipt and grant its entitlement in one local transaction.

Separating wallet, inventory, and payments now would require explicit cross-service workflows and compensations for those operations. Prefer local atomicity for these tightly related invariants; independently deployed services can still contain cohesive internal modules.

Core verification and Economy reward credit are deliberately not one ACID transaction. The interface represents that delay explicitly with pending rewards and recoverable event delivery.

## Communication

- Browser and internal request/response operations: HTTP + JSON with version-controlled OpenAPI contracts and generated types/clients where useful. Define deadlines, authorization, payload bounds, error envelopes, and idempotency behavior.
- Durable domain facts: a broker with transactional outbox/inbox handling. Broker selection is pending: ADR-003 now recommends **RabbitMQ** for the current workload and learning preferences. Consumers must account for redelivery.
- Do not assume broker acknowledgments, deduplication, or an “exactly-once” feature makes the entire database-plus-external-provider workflow exactly-once.
- Reserve gRPC for a measured or contract-generation need; it is not a prerequisite for Python/Go interoperability.

### Verified gameplay reward

1. Core validates an ordered input segment using the authoritative state and run's engine/config version.
2. In one Core database transaction, it persists the accepted checkpoint and an outbox record for `RunSegmentVerified.v1`.
3. A publisher sends the record to the selected broker and records acknowledgment. A crash can cause redelivery.
4. Economy verifies the producer's authority and validates the event, run/player identity, expected progression, and evidence. It applies the pinned reward-policy version, eligibility, and caps.
5. In one Economy database transaction, it records the consumed event, credits the ledger if eligible, and writes its own resulting outbox event.
6. The consumer acknowledges only after commit. Redelivery returns the prior result without a second credit.
7. If Economy or the broker is unavailable, verified evidence remains durable and the interface shows pending credit. Valid work is retried, not silently dropped.

Use unique keys for both event identity and business identity, such as `(run_id, segment_sequence, reward_kind)`. A new event ID cannot make the same segment earn twice. An authenticated producer does not eliminate payload/schema validation. Handle out-of-order segments explicitly; do not rely on a presumed global event order.

The event carries verified collection facts, not a player-supplied amount to credit. Economy owns currency rules. Store versioned policy/config artifacts so delayed events cannot accidentally use today's changed rules.

### Telegram payments

- Economy creates an order with its authoritative catalog price, user, currency, and opaque invoice reference. Platform performs authenticated Telegram transport on Economy's behalf.
- Platform handles pre-checkout through a bounded synchronous Economy eligibility check. Do not hide it behind a slow asynchronous backlog. On an unavailable validator, decline instead of authorizing an unknown order.
- On a successful-payment update, Platform durably records the authenticated update and its outbox event before acknowledging ingestion. Economy independently validates the order mapping, payer, amount, currency, and charge ID before fulfillment.
- Economy deduplicates by actual charge and order business rules, atomically records the payment and entitlement, and exposes fulfillment status. Distinct charge IDs for a single-purchase order require an explicit duplicate-purchase/refund policy.
- Refunds are asynchronous business/transport workflows. A timed-out remote call remains unknown/reconciling until confirmed; it is not automatically success or failure. Reconciliation and operator review must exist before selling items.
- Platform owns the bot credential and provider transport, while Economy owns the decision and accounting. The credential is not distributed to every service.

### Read consistency and run startup

Economy is the source of truth for balances and owned/equipped items. Core may use derived views for cosmetic display, but a gameplay-relevant loadout would require an authoritative versioned snapshot at run start. Freeze a run's loadout and rule version for its lifetime. Cosmetics remain physics-neutral in the proposed MVP.

Show eventual-consistency states rather than claiming a reward is spendable before Economy has committed it. Leaderboards are replaceable projections, not wallet authority. Keep the first leaderboard implementation inside Core; extract a progression service only after workload or ownership warrants it.

## Data and security ownership

Start with one PostgreSQL cluster if operationally convenient, but separate databases and credentials per service. No service reads/writes another service's tables, performs cross-service SQL joins, or controls another service's migrations. Separate infrastructure ownership from domain-data ownership. Each service owns its backup/restore and migration contract.

Platform issues short-lived signed application credentials; each resource service verifies signature, issuer, audience, expiration, and authorization itself. A forwarded user-ID header is not sufficient. Use separate authenticated workload identities for service-to-service actions, broker subject permissions, and key rotation. Define account suspension/revocation behavior and accepted propagation delay.

Money/currency values use explicit integral units, never floats. IDs and wide integer seeds use a JSON representation that the JavaScript frontend can consume without precision loss. Each API and event validates values and ranges. Audit privileged operations and propagate correlation IDs without logging tokens or raw initialization data.

## Deterministic game core: cross-language risk

Use a TypeScript browser simulation and authoritative Go Core verification with
identical numeric rules, PRNG, collision/event ordering, and shared fixtures.
The two implementations already exist locally; the network verification service
does not. HTTP input checkpoints are the selected future transport. WebSockets
and Go WASM are not initial requirements. Verification of legal inputs alone does
not establish human play.

## Repository and local deployment proposal

```text
apps/web/
services/platform/           # Python
services/core/               # Go
services/economy/            # Python
packages/game-sim/           # pure TypeScript simulation
services/core/simulation/    # existing pure native Go simulation
contracts/http/
contracts/events/
tests/system/
deploy/compose/
docs/
```

Use one monorepo initially, separately buildable images, pinned language/dependency toolchains, one documented local startup path, per-service PostgreSQL databases, and one development broker after its selection is approved. Docker Compose is the proposed local environment. Do not add Kubernetes, a service mesh, an authentication microservice, or a separate analytics pipeline yet.

Independent deployment must be genuine: compatible API/event versions, no required synchronized rollout for routine changes, and producer/consumer compatibility checks in CI.

## Testing and agent pipeline changes

Follow the repository RED → GREEN → REFACTOR workflow and independent review.
Future service checks include:

- Python: pytest, Hypothesis, Ruff, strict type checks, real-DB integration tests.
- Go: standard tests, native fuzz tests, race checks, gofmt/go vet, verification benchmarks, real-DB integration tests.
- Frontend: Vitest/fast-check, Playwright, TypeScript/Go fixture parity checks.
- Contract tests: schemas, generated clients, authorization, and compatibility with the previously supported API/event version.
- Distributed failure tests: publisher crash after broker acceptance; consumer crash after DB commit before acknowledgment; duplicate/reordered events; Economy outage; delayed payment; ambiguous refund; projection rebuild.
- System tests: authenticate → start run → validate segment → process event → credit wallet; cosmetic order → invoice/update → fulfill exactly once; refund → confirmed reversal.

Test the broker/database integration for real; mocks cannot validate redelivery or transaction boundaries. Store concise RED/GREEN evidence in PRs. No agent edits another service's tables, bypasses a contract, or deploys unreviewed money/auth logic to make a test pass.

## Consequences and status

This design adds distributed delivery, independent schemas, additional deployments, and multi-language contracts. The proposed benefit is isolated simulation scaling and clear business ownership, not proven faster delivery or lower cost. Track those tradeoffs rather than describing microservices as inherently better.

Not implemented: network services, broker deployment, service databases, or
production performance measurements. The local frontend, both simulation
implementations, and their CI configuration exist; they do not establish
commercial readiness.

## Sources

[1] https://fastapi.tiangolo.com/features
[2] https://docs.aiogram.dev/en/latest/dispatcher/webhook.html
[5] https://go.dev/doc/diagnostics
