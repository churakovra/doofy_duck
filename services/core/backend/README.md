# Core run service

This retained Go Core is the fallback HTTP service for account-owned game runs. The default local stack uses TypeScript Core. It replays exact per-tick inputs with `services/core/simulation`, persists state and checkpoint responses in PostgreSQL, and writes completion events to a transactional outbox.

Build and run from the repository root:

```sh
go -C services/core/backend test ./...
go -C services/core/backend vet ./...
go -C services/core/backend generate ./db
go -C services/core/backend run ./cmd/migrate
go -C services/core/backend run ./cmd/core
```

`sqlc` generation is pinned to v1.29.0 in `db/generate.go`; pgx is pinned in `go.mod`. The service listens on `:8080` by default. Runtime configuration is `CORE_DATABASE_URL`, `ACCESS_TOKEN_PUBLIC_KEYS_JSON` (JSON map from key ID to base64url raw Ed25519 public key), `CORE_PLATFORM_COMPLETION_URL`, `CORE_TO_PLATFORM_TOKEN`, and `CORE_OPERATOR_TOKEN`. `CORE_DB_MAX_CONNECTIONS` defaults to 32 and accepts 2–256; `CORE_OUTBOX_WORKERS` defaults to 4 and accepts 1–32. `CORE_AUTO_MIGRATE=true` enables startup migration for local development; deployments should run `/core-migrate` as a one-shot before starting `/core`.

The migration runner records numbered migrations and serializes concurrent application with a PostgreSQL advisory lock. The app role needs only normal run-table access after migrations; provision a separate migration role for deployments that require tighter DDL separation.

Set `CORE_TEST_DATABASE_URL` to an isolated PostgreSQL database when running tests. `TestPostgres...` tests use a unique schema, apply migrations concurrently, and exercise account scoping, first-create races, checkpoint idempotency/conflicts/gaps, takeover fencing, replayed death, durable outbox retry after a simulated worker crash, and outage deadline extensions. Set `CORE_TEST_PLATFORM_URL` and `ACCESS_TOKEN_PUBLIC_KEYS_JSON` to also verify a token from the platform development-auth endpoint.

`go run ./cmd/loadtest` runs deterministic active clients against Core and Platform's development-auth endpoint. Configure `CORE_LOAD_CLIENTS`, `CORE_LOAD_DURATION` (Go duration, default `1h`), `CORE_LOAD_CHECKPOINTS_PER_SECOND`, `CORE_LOAD_TELEGRAM_USER_ID_START`, `CORE_LOAD_BASE_URL`, and `CORE_LOAD_PLATFORM_URL`, or use the equivalent command flags. Each virtual account gets its own Platform token and repeatedly replays server-created runs with the surviving sim controller. Measurement begins only after all requested clients authenticate and receive initial runs; startup retries are reported separately. Checkpoint phases are spread across the client interval. Tokens refresh every eight minutes, and checkpoint replies are compared against local replay; periodic duplicate submissions check idempotency. After load generation ends, already completed flights have up to five seconds to finish receipt delivery; the final elapsed time and rate include this drain. The final aggregate reports active clients, accepted checkpoints and ticks, unacknowledged checkpoints, idempotency checks, completion receipts, errors, reconnect drain time, achieved request/tick rates, and p95 latency. It exits nonzero when fatal errors, unacknowledged work, p95 above one second, failed checkpoint attempt fraction above 1%, or a configured minimum checkpoint rate fails. `-maximum-failure-fraction` configures that fraction; rate limits and transport/HTTP failures count, while intentional offline queueing does not. A run shorter than the configured duration is not evidence of a full-hour test. Use additional duration beyond one hour to observe cap completions after startup phases and credential-renewal delays.

To measure a buffered reconnect after an operator-recorded outage, add `-outage-after 10m -outage-duration 5m -operator-token "$CORE_OPERATOR_TOKEN" -operator-url http://core:8080`. The operator URL must reach Core directly; the local gateway intentionally hides `/internal/*`. During the interval each client continues deterministic simulation locally and queues ordered, bounded checkpoints, then drains them after recovery.

Authenticated requests use a bounded admission queue: at most 256 handlers execute
while up to 1,024 requests wait for at most five seconds. Queue overflow or expiry
returns 429 with Retry-After; cancellation releases waiting capacity. These are
per-instance limits, not a global distributed rate limit.
