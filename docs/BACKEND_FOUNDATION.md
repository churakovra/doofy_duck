# Backend foundation implementation record

ACCOUNT and RUN were approved on October 17, 2026, before SHOP. Local implementation
is present; the sustained local capacity test passed. Outage recovery and external
acceptance remain under verification.
This record distinguishes requirements from executed verification.

## Approved behavior

- Python identity/accounts and Economy modules; Go run issuance/verification;
  separate service-owned PostgreSQL databases and authenticated HTTP delivery.
- One unresolved run per account; explicit device takeover fences old writers.
- Existing flights may finish locally through outages. Retain/retry inputs;
  a completed unresolved result blocks the next account-backed run.
- Storage failure permits play with a warning about losing unsent inputs on close.
  Cross-device recovery includes only accepted server state.
- Cap runs at 216,000 active ticks; pause does not consume flight time.
- One-hour no-contact submission window; server-recorded outages extend it through
  one hour after recovery. Client claims cannot grant extensions.
- Checkpoints never credit currency. Death/cap completion produces a deduplicated
  fact. Issuance, SHOP, paid continue and XTR stay disabled.

## Acceptance target

Sustain 1,000 active flights for one hour, approximately 500 checkpoint requests and
60,000 replay ticks per second. Target checkpoint p95 below one second, unexpected
failures below 1%, no lost acknowledged checkpoints and no growing delivery backlog.
After a five-minute outage with reconnects spread over one minute, drain within
15 minutes. These are acceptance targets, not benchmark results.

Use managed PostgreSQL and redundant applications; verify database failover with no
acknowledged-record loss for a single instance failure and recovery within one hour.
Provider, monthly spend and deployment await measured sizing and separate approval.
Local Docker checks do not establish hosted guarantees.

## Delivered local behavior

Python validates Telegram initialization, signs short-lived credentials, rotates
refresh sessions and stores deduplicated completion receipts. Core independently
checks identity and ownership, issues pinned run descriptors, persists replayed
checkpoints and input evidence, fences stale writers and delivers completion facts
from its outbox. Account best and the latest verified result survive reload and
device changes. No account balances are created.

Account mode records exact simulation ticks and retries retained traces. Practice
and wardrobe remain available separately. Automatic refresh requires Web Locks and
writable local storage; otherwise explicit reauthentication is required. IndexedDB
failure permits memory-only input retention with a visible warning. Another device
can recover accepted server state, not the previous device's unsent inputs.

## Executed verification — October 17, 2026

- `npm run check`: types, lint, 304 unit/fixture tests, native simulation tests and
  production build passed. The build reports its existing large-chunk warning.
- Python Ruff/format, strict mypy and unit checks passed. The pinned Linux test
  image ran all ten Python tests against real Platform/Economy PostgreSQL databases.
- Core tests against real PostgreSQL, race checks and vet passed, including actual
  Python-produced credential interoperability, migration concurrency/upgrade,
  ownership, sequence/idempotency, writer fencing, cap/deadline/outage behavior,
  completion retry and latest-result account isolation.
- Verified completion releases the run reservation before receipt delivery. Real
  database regressions cover retryable/permanent delivery failure without invalidating
  the score or blocking a later flight, plus upgrade of earlier lifecycle rows.
- Client unit tests cover delayed authentication, stale polling, account changes,
  storage revision fencing and scoped key-only IndexedDB writes. These use injected
  browser APIs; they do not establish physical WebView/IndexedDB performance.
- Rebuilt Compose services and cross-service smoke passed: identity ownership,
  authoritative replay and one stored completion receipt.
- Independent reviews covered authentication, lifecycle/concurrency, replay and
  delivery boundaries; findings were returned to implementation workers and fixed.
- Browser suites, real Telegram/mobile acceptance, managed failover and restore
  drills have not run. Committed CI configuration is not a hosted CI result.

### Local capacity experiments

Docker Desktop 29.8.2, Linux/aarch64, ten allocated CPUs and 7.75 GiB memory. Client,
gateway, Core, Python and PostgreSQL share this machine. Local HTTP has no public
TLS/WAN or synchronous database replica, so results cannot establish hosted capacity.

The first 60-second attempt failed startup: only 359 of 1,000 clients started because
the original harness treated startup backpressure as fatal. The corrected harness
waits for all accounts/runs before starting measurement and reports startup separately.
A second 60-second attempt started all 1,000, accepted 29,000 checkpoints, had no
unacknowledged work and p95 210 ms; 194 checkpoint attempts were rate-limited (0.66%).
It failed the configured 475/s minimum with 467.8/s over the conservative 62-second
elapsed window, including phase ramp and shutdown. These are failed preflights,
not evidence of one-hour acceptance.

A 120-second preflight passed with all 1,000 clients: 58,999 accepted checkpoints,
zero failed attempts/unacknowledged work and p95 4 ms. The conservative elapsed
window was 122 seconds (483.6 checkpoints/s, 58,033.6 ticks/s). An exploratory longer
run reached 510 seconds with all 1,000 active and 498 accepted checkpoints/s; it was
stopped deliberately before final observability/lifecycle revisions. Its 75 retried
attempts and incomplete duration do not constitute sustained acceptance. The final
one-hour measurement below passed; the five-minute-outage measurement is pending.

The final sustained test started at 12:46:19 UTC against Core image
`sha256:aa6049458a78946ddd2031dde8257e54e703c43427549a99acc70bb81cda5772`.
Its source is included in `7fabb3f`; the web reconciliation follow-up is `0e311e2`.
The load executable SHA-256 is
`0f4b2e01e5114b08615242dd3d36d5f9b5c1d187429a48523b81270006646037`.
Duration is 1h2m to include cap completion after one hour of active ticks and
credential-renewal delays. The container exited successfully: 1,858,999 accepted
checkpoints over 3,722 seconds, 499.5 accepted checkpoints/s and 59,935.6 replay
ticks/s; p95 was 3 ms. All 1,000 initial clients were ready before measurement.
There were 1,000 verified flight-cap completions, 30,000 idempotency checks, zero
fatal errors and zero unacknowledged checkpoints. The 145 failed checkpoint
attempts were rate limits (reported failure fraction 0.0001), retried successfully.
Startup had 930 retries, tracked separately. Post-restart PostgreSQL reconciliation matched all 1,858,999 accepted sequences
and 223,079,880 persisted ticks exactly. All 1,000 cap results were completed,
verified and delivered; the replacement 1,000 runs remained active. All 1,005
outbox records across the local experiments were delivered, with no pending backlog.
This also checks persistence through the subsequent local application/database stop
and restart; it does not establish replica failover durability.

The remaining bounded outage test uses container
`doofy-load-outage-final-1000`, the same frozen image/executable, fresh account IDs
starting at 940000000, and flags `-duration 12m -clients 1000
-checkpoints-per-second 500 -minimum-checkpoint-rate 300 -outage-after 2m
-outage-duration 5m -reconnect-spread 1m`. This simulates disconnected clients
continuing locally and records an authenticated operator outage; it is not a
database failover or hosted HA test. Existing local services were stopped when
launched and restarted without rebuilding; startup is excluded from measurement.
The first outage run failed (exit 1). All 1,000 accounts started after 51.7 seconds
of startup retries while local services recovered. It accepted 271,116 checkpoints,
but ended with 1,000 unacknowledged checkpoints and 1,000 fatal client errors.
There were 40,671 rate-limited attempts (12.36%); total checkpoint failure fraction
was 16.37%, above the 1% gate. p95 was 946 ms and the reported maximum individual
drain was 167,798 ms. Container inspection subsequently showed the gateway, Core, Python and PostgreSQL
all stopped at 14:19:46–48 UTC, matching the plateau in accepted submissions.
The run was interrupted by a stack shutdown; its final unacknowledged/fatal counts
cannot diagnose recovery correctness. Rate limiting before shutdown remains real
reconnect-backpressure evidence. Diagnose bounded admission behavior and rerun with
the services available for the complete measurement. The earlier sustained
steady-load pass remains separate evidence.

A subsequent targeted fix preserves the 256 active handlers while allowing up to
1,024 authenticated requests to wait for five seconds. Overflow/expiry still
returns 429 with Retry-After, and cancellation releases waiting capacity.
Expected-red regression, focused unit/race/vet, real-PostgreSQL tests and independent
review passed. This is a tested mitigation, not a passed recovery load measurement.

Logs remain in Docker; retrieve the interrupted run summary with:

```sh
docker logs --tail 8 doofy-load-outage-final-1000
docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' doofy-load-outage-final-1000
```

The completed sustained-test logs remain in `doofy-load-hour-final-1000`.
Final routine verification was rerun on October 17 after the last client test:
all 304 tests, types, lint, native simulation tests and build passed. Browser
suites were not requested and did not run.

Before this run, a final service rebuild/migration preserved all 361,338 existing
checkpoint records and their combined content fingerprint. This checks application
restart persistence on the same local database, not managed database failover.

## Related documents

- [Service architecture](ADR-001-MICROSERVICES.md)
- [Currency and delivery](ADR-003-CURRENCY-AND-BROKER.md)
- [Development plan](DEVELOPMENT_PLAN.md)
- [MVP specifications](MVP_SPECIFICATIONS.md)
