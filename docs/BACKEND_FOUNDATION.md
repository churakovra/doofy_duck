# Backend foundation implementation record

ACCOUNT and RUN were approved on October 17, 2026, before SHOP. Implementation is
in progress. This record distinguishes requirements from executed verification.

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

## Verification during implementation

Pending. Record only checks actually executed on the delivered state. Keep real
Telegram, browser, hosted load and failover/restore acceptance separate.

## Related documents

- [Service architecture](ADR-001-MICROSERVICES.md)
- [Currency and delivery](ADR-003-CURRENCY-AND-BROKER.md)
- [Development plan](DEVELOPMENT_PLAN.md)
- [MVP specifications](MVP_SPECIFICATIONS.md)
