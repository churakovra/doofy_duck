# ADR-001 — Python application and Go Core

Status: approved architecture direction, October 17, 2026. This replaces the earlier
proposal to deploy Platform and Economy independently. Hosted capacity and release
acceptance remain separate from design approval.

## Applications and ownership

| Application | Tools | Ownership |
| --- | --- | --- |
| Platform | Python, FastAPI/Pydantic, SQLAlchemy/Alembic | Telegram identity, accounts and sessions; separate Economy modules for verified receipts and future wallet, inventory, shop and payments |
| Core | Go, net/http, pgx/sqlc | Server-issued runs, deterministic verification, checkpoints, results and completion outbox |

Keep the React/Vite/PixiJS client and pure TypeScript/Go simulations. Platform and
Economy are module boundaries inside one application, not separate deployments.
These boundaries keep service ownership explicit; they do not require additional
services as the project grows.

Use managed PostgreSQL for hosting, with separate databases, credentials and
migrations per application. No cross-service SQL access or joins. Docker Compose
supplies local startup. Pin dependencies and toolchains in implementation manifests.

## Authentication and contracts

Route browser traffic through one public HTTPS origin. Platform validates Telegram
initialization and issues short-lived signed credentials. Core independently checks
signature, issuer, audience, expiry and ownership. Access tokens remain in browser
memory; rotating secure HttpOnly refresh cookies require CSRF protection. Development
authentication must be explicit and must prevent production startup when enabled.
Never log tokens or raw initialization data.

Use versioned HTTP/JSON contracts with bounded payloads. Apply flaps locally; submit
ordered input checkpoints for Go replay. Client positions, scores and local balances
are never authoritative. Preserve pinned simulation/configuration identities.

## Durable delivery and accounting

Use authenticated HTTP delivery with a transactional Core outbox and Python inbox.
Save verified completion evidence and its outbox entry atomically. Retry delivery;
commit event/business deduplication with receipt evidence before returning success.
Lost responses and restarts may cause repeated delivery.

RabbitMQ is deferred until measured delivery or routing needs justify its operating
cost. It would not replace transaction boundaries, retries or deduplication.

Checkpoints never credit currency. A verified death or active-flight cap produces a
completion fact. Issuance stays disabled until earning rules are approved. Future
continue retains run identity and credits only new earnings from the next life.

Keep future wallet debit and cosmetic grant in one Economy database transaction.
Platform modules own Telegram credentials/transport; Economy owns payment business
state. No distributed ACID transaction is assumed between Python and Core.

## Scaling and operations

Initial acceptance targets 1,000 simultaneous active flights: about 500 checkpoints
and 60,000 replay ticks per second at two-second checkpoints, plus other traffic.
These are workload targets, not measured capacity. Benchmark real transactions and
deterministic surviving workloads before selecting hosted instance sizes.

Stateless API instances, bounded connections/work, durable retries and fenced
writers permit independent Go/Python scaling. Hosted acceptance requires redundant
application instances, managed database failover, recovery within one hour, and no
acknowledged-record loss from a single instance failure. Verify synchronous database
durability and exercise failover; backups alone do not prove this guarantee.

Provider, budget and deployment require separate approval after measured sizing.
Include monitoring, safe migrations/rollback, restore drills and incident procedures.
Kubernetes, Redis, a service mesh and a broker are not initial requirements.

## Implementation evidence

See the [code map](ARCHITECTURE.md), [development plan](DEVELOPMENT_PLAN.md) and
[backend implementation record](BACKEND_FOUNDATION.md). Approval does not claim
that unexecuted hosted, Telegram, browser or failure acceptance has passed.
