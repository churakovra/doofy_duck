# Backend operations and hosted acceptance

This runbook accompanies the [approved backend foundation](BACKEND_FOUNDATION.md).
It does not authorize a deployment or establish hosted availability.

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

## Monitoring and incident response

Alert on failed readiness, elevated checkpoint errors/latency, exhausted database
connections, disk/PITR health, oldest pending completion age and stalled delivery.
Count verified replay separately from completion delivery. Log correlation IDs,
safe error codes and outcomes; do not log tokens, raw initialization data or full
input traces. Keep operational records private with documented access and retention.

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
