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

## Hosting shortlist — researched October 17, 2026

The local preflight observed roughly one CPU of Core work and substantially less
than one CPU of PostgreSQL work at the target rate. These are snapshots on shared
local hardware, not cloud sizing guarantees. Start hosted evaluation with two Core
replicas of 2 vCPU/4 GiB each so one can carry the traffic, two Python replicas,
redundant ingress and a synchronously protected managed database. Separate owned
databases/roles may share a managed cluster; separate clusters cost more.

Compare a European region near the eventual pilot population. Region, eligibility,
tax, network latency and account-specific availability must be confirmed before a
quote or deployment. Illustrative always-on USD/month component estimates:

| Option | Applications and ingress | Managed database | Durability decision |
| --- | --- | --- | --- |
| DigitalOcean App Platform + Advanced PostgreSQL | Two Core 2-vCPU/4-GiB instances at $78 each; two Python and two ingress 1-vCPU/1-GiB instances at $34 each: $292 | Entry 2-vCPU/8-GiB primary and matching standby at $130 each: $260; combined compute floor $552 | Conditional candidate only: require plan support for quorum synchronous replication, verify actual settings and failure behavior; Advanced is public preview |
| Render applications + Render PostgreSQL HA | Two Core 2-CPU/4-GB instances at $85 each; two Python and two ingress 1-CPU/2-GB instances at $25 each: $270 | Two 1-CPU/4-GB database instances at $55 each plus $25 Pro workspace: combined floor $405 before storage | Exclude the documented async database HA from the approved zero acknowledged-loss target |
| AWS applications + RDS PostgreSQL Multi-AZ | Quote two Core and two Python instances across zones plus redundant load balancing | Quote a Multi-AZ instance deployment with synchronous standby, storage, backups and I/O in the chosen region | Candidate for a synchronous deployment; measure failover and accepted-record preservation before acceptance |

DigitalOcean figures come from its [application pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)
and [PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/).
New Standard clusters cannot add standby nodes under the October 2026 plan change;
do not reuse an older $60 HA estimate. Its [API contract](https://docs.digitalocean.com/products/databases/postgresql/reference/api/)
exposes plan-dependent synchronous replication and describes Advanced preview status.
If the approved quorum/failover topology needs three database nodes, the illustrative
DigitalOcean database compute becomes $390 and the combined floor $682. A two-node
price alone does not establish quorum availability after one node fails.
Render figures use its [pricing table](https://render.com/pricing); its
[HA documentation](https://render.com/docs/postgresql-high-availability) explicitly
permits losing recent writes during asynchronous failover. AWS documents a synchronous
standby for [RDS Multi-AZ instances](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html);
use its [regional pricing/calculator](https://aws.amazon.com/rds/postgresql/pricing/)
for a comparable quote rather than inventing a region-independent total.

The floors exclude additional storage, retention growth, backup overages, traffic,
logs/alerts, support, tax and migration/failover test environments. They are not an
approved spend or a statement that these sizes pass the workload. Budget seven days
of PITR initially and price retained evidence separately. The early local sample
used about 179 MB for 39,759 checkpoint records plus related database objects; at
continuous target load, storage can grow by hundreds of GB per day. This is a rough
extrapolation, not a measured daily rate. Set an approved evidence retention/archive
policy and measure total write/storage/egress rates before approving monthly spend.
Do not delete accepted evidence automatically to fit a small database tier.
