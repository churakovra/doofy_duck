# Backend operations and hosted acceptance

This runbook describes operational checks. It does not establish hosted availability.

## Before enabling account-backed play

Select a provider and approve monthly cost after measuring the active-flight workload.
Configure one HTTPS origin, redundant application replicas, a managed PostgreSQL
primary with synchronous failover protection, separate application credentials,
connection limits and point-in-time recovery. Check the provider's actual guarantees;
managed databases and backups alone do not establish zero acknowledged-write loss.

Production must disable development authentication and use newly generated production
signing keys, workload credentials and a real Telegram bot token. Never deploy the
ignored local development environment file. Keep Core's operator credential separate
from user credentials and the completion-delivery credential. The public gateway
must not expose internal completion or outage operations.

Run migrations once as a release job before rolling application replicas. Preserve
compatibility with the previous supported HTTP/event contract during rollout. Stop
new run issuance if schema, signing configuration or durable storage is unavailable.
A successful readiness response is not a guarantee against a later outage.

Core readiness requires every migration shipped with the running service, including
the delivery-lifecycle migration. A database containing only an earlier migration
must remain unready until the release migration job completes.

Platform API connections and the settlement CLI share PostgreSQL defaults of five
seconds for connection establishment, five seconds for lock acquisition and
30 seconds for each statement. Explicit database-URL timeout options are retained,
including stricter limits; existing `search_path` options are preserved. These
limits bound individual database operations, not a complete settlement batch or
request. Tune overrides against measured work rather than disabling timeouts to
hide contention.

Platform and Economy SQLAlchemy pools are independently bounded per process.
`PLATFORM_POOL_SIZE` and `ECONOMY_POOL_SIZE` default to 5; their corresponding
`*_POOL_MAX_OVERFLOW` values default to 10 and `*_POOL_TIMEOUT` values default to
30 seconds. Pool size must be positive, overflow nonnegative, and timeout finite
and positive. PostgreSQL connections also use a five-second connect timeout and
the statement/lock timeouts above unless explicitly supplied in the database URL.
For capacity planning, calculate each service/database's maximum as
`processes × replicas × (pool_size + max_overflow)`; include every concurrently
running process, including settlement workers/CLI jobs where applicable. Add
Core's separately configured `CORE_DB_MAX_CONNECTIONS` pool (default 32 per Core
process), then reserve PostgreSQL capacity for migrations, administration and
other workloads. Compare the resulting total with the actual database connection
limit; choose values from measured workload and available reserved capacity rather
than assuming the defaults fit a deployment.

TypeScript Core emits structured `admission_state` events with `outcome` values
`admitted`, `released`, and `rejected`. Fields also include
point-in-time `active` and `waiting` counts and `wait_ms`. Per
instance, by default at most 256 authenticated handlers execute and 1,024 wait up to five
seconds; authenticated handler work has a 30-second context timeout. Overflow or
queue expiry returns 429 with `Retry-After: 1`; cancellation frees waiting capacity.
These counters are event snapshots, not interval aggregates or a global rate limit.

Outbox telemetry uses `completion_backlog` every 30 seconds (`pending`, `retrying`,
`oldest_age_ms`); retrying excludes first-attempt leased events. Sampling has a
two-second query deadline, and query failure emits `completion_backlog_sample_failed`
with a fixed reason. Each delivery attempt emits `completion_delivery` with status,
HTTP status, attempt and safe reason plus event/run IDs. Successful acknowledgements
emit `completion_delivery_age` with outcome and elapsed `age_ms`; it excludes event
and run identifiers. Worker-level failures emit `completion_dispatch_failed`.
These logs expose outcomes and sampled backlog, but do not by themselves provide
durable metrics, alert delivery, or hosted monitoring.

## Monitoring and incident response

Alert on failed readiness, elevated checkpoint errors/latency, exhausted database
connections, disk/PITR health, oldest pending completion age and stalled delivery.
Count verified replay separately from completion delivery. Log correlation IDs,
safe error codes and outcomes; do not log tokens, raw initialization data or full
input traces. Keep operational records private with documented access and retention.

Configure these initial alerts in the selected hosting system before hosted acceptance:

| Signal | Initial trigger | First response |
| --- | --- | --- |
| Public/Core readiness | Two consecutive failed probes, 30 seconds apart | Check application/database reachability; suspend new starts if durable storage is unavailable |
| Checkpoints | p95 above one second or failed attempts at/above 1% for five minutes | Inspect correlated outcome logs, CPU, connections and database latency |
| Completion delivery | Oldest pending fact above 60 seconds for five minutes, or any permanent rejection | Inspect event ID and safe outcome reason; preserve verified gameplay and retry state |
| Durable storage | 70% capacity warning, 85% critical, or PITR/WAL protection unhealthy | Add capacity or repair protection before exhaustion; never discard accepted evidence ad hoc |
| Backup/recovery | Last successful scheduled backup older than 24 hours, or restore drill overdue | Repair backups and schedule isolated restoration; document recoverable timestamp |

Exercise notification delivery to the responsible operator during the hosted drill.
These are configuration requirements; this repository does not connect to a provider's
alerting account. Tune thresholds from measured workload without weakening durability.

During a Core/database incident, disable new starts while allowing existing browsers
to retain inputs. Record the outage interval through authenticated operator tooling,
using monitoring evidence for its start and recovery. An interval may be recorded
retrospectively after the database returns; players cannot create extensions. Validate
recovery before recording the end, then verify affected submission windows extend
through one hour after recovery. Avoid rejecting the backlog before recording the
known outage. Preserve input evidence and receipt history when investigating errors.

Inspect completion backlog by status and oldest age. Fix connectivity/authentication
or payload incompatibility before retrying; do not manually mark undelivered events
successful. Duplicate delivery must return the same receipt. Conflicting evidence
requires investigation, not editing verified scores or granting currency manually.
Currency issuance remains disabled during this phase.

## Backup, restoration and rollback

Back up each owned database with its migration version and secure configuration/key
references. Enable managed point-in-time recovery and test restoring to an isolated
environment. Keep signing keys and provider credentials out of repository artifacts
and ordinary database exports. Record the restored timestamp and any lost interval.

A restore drill must verify account/session access, run ownership, accepted checkpoint
replay, completion inbox/outbox deduplication and pending retry recovery. Never attach
a restored test environment to production delivery endpoints. Confirm restored pending
work cannot create a second receipt. Measure recovery time against the one-hour target.

For a bad application release, pause new starts and roll back compatible binaries.
Prefer a forward schema repair when destructive downgrade could discard accepted work.
Do not delete checkpoint, outbox or receipt records to silence a failed migration.
Reopen starts only after readiness and recovery checks pass.

## Required hosted evidence

The repository does not currently provide a load generator for these scenarios.
Implement or select one before collecting hosted capacity evidence.

- One hour of 1,000 active flights: approximately 500 checkpoints/second and 60,000
  replay ticks/second, checkpoint p95 below one second, unexpected failures below 1%,
  no lost acknowledged records and no growing completion backlog.
- A five-minute outage, reconnects spread over one minute, and backlog drained within
  15 minutes, with no duplicate business effects.
- Application instance loss and managed database failover with zero acknowledged-record
  loss for a single instance failure; restored service within one hour.
- Isolated restore drill, compatible migration/rollback, key rotation, and safe operator
  access. Record named infrastructure, versions, dataset and date for each check.
- Real Telegram mobile/desktop authentication and lifecycle acceptance in both languages;
  local HTTP tests or browser emulation do not establish this evidence.

Provider pricing comparisons must state region, application/database sizing, HA topology,
backup retention, traffic assumptions and excluded charges. Do not present a base-tier
price as the cost of the required redundant deployment. Budget and deployment require
separate owner approval.
