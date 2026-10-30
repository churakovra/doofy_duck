# Core run API v1

All user routes require a short-lived EdDSA access token. Core verifies the signature against the configured `kid` allowlist, exact algorithm `EdDSA`, issuer `doofy-platform`, audience `doofy-core`, UUID `sub` and `jti`, integer `iat`/`exp` (maximum lifetime 600 seconds), and the exact `scope: ["run:write"]` claim. Platform service calls use a separate bearer secret.

Core creates run IDs, seeds, simulation descriptors, and rules config. Clients submit only per-tick `FLAP` inputs; each tick with no input is represented by an empty array. Client position, score, totals, currency, simulation state, and completion reason are never accepted as authority. Requests over the configured in-flight limit return `429` with `Retry-After: 1`; clients may retry that transient response with the same checkpoint sequence, idempotency key, and body.

## `POST /api/v1/runs`

Creates one server-owned run for the authenticated account. Returns `201` and the complete authoritative simulation state plus `checkpointSequence`, `writerGeneration`, `activeTicks`, `activeTickLimit` (216000), `submissionDeadline`, status, and an opaque `writerToken` (only on this initial response). An existing active run is returned with `200` for recovery and without its writer token; clients must retain their writer token or use explicit takeover before submitting. Only an active run or a genuinely unverified `completion_pending` run blocks a new run (`409`). Once replay verification succeeds, Core atomically marks the run `completed` and queues its Platform event with `deliveryStatus: pending`; the run no longer reserves the account's next flight. Delivery success or rejection changes only `deliveryStatus`, never gameplay lifecycle or verification. At most one active or unverified pending run exists per account.

## `GET /api/v1/runs/current` and `GET /api/v1/runs/{run_id}`

Return the same run snapshot, or `404` when it is absent or belongs to another account. Current may return no run as `404`. Snapshots contain the descriptor/config/state needed to reconcile the local flight.

## `GET /api/v1/runs/latest`

Returns the most recently created run owned by the authenticated account, including completed, rejected, abandoned, active, or delivery-pending runs. Runs are ordered by `created_at` descending with `id` descending as a stable tie-break. The response is the direct run snapshot shape and never includes `writerToken`; `404` means the account has no runs. Clients should check `/current` first to recover active or genuinely unverified pending work, then use this route to restore the latest verified terminal result after a reload or on another device.

## `GET /api/v1/runs/progress`

Returns the authenticated account's authoritative cross-device best score as `{"bestScore":0}`. The projection is raised monotonically in the same transaction as a server-verified death or flight-cap checkpoint. Pending or rejected account delivery does not erase the verified score. Local-practice scores are never imported.

## `POST /api/v1/runs/{run_id}/checkpoints`

Body:

```json
{
  "checkpointSequence": 0,
  "writerGeneration": 1,
  "writerToken": "opaque-token-returned-when-run-was-created",
  "idempotencyKey": "client-generated-opaque-key",
  "ticks": [[], [{"sequence": 0, "action": "FLAP"}]]
}
```

A checkpoint contains 1–120 exact simulation ticks. `writerToken` and `writerGeneration` are required request fields; the token stays client-held and is stored only as a hash. Each tick advances one active simulation tick, including the initial READY-to-RUNNING tick; a READY run must begin with `FLAP`. Each tick has zero or one `FLAP`; input sequence numbers are contiguous across the run. The server advances the shared TypeScript simulation for each tick. A run ends on `DEAD` or after 216000 active ticks (`flight_cap`). State, tick count, checkpoint sequence, and completion outbox row commit in one transaction before acknowledgement. A duplicate sequence/key/body returns the original response; a reused key or sequence with different contents is `409`. Stale writer generations are fenced with `409`; gaps are `409`; malformed/oversized batches are `400`/`413`; expired submission windows are persisted as rejected and return `410`.

## `POST /api/v1/runs/{run_id}/takeover`

An explicit account-owner action rotates `writerGeneration` and the opaque `writerToken`, returning a current snapshot with the new token. Every old writer checkpoint and abandon request is rejected after rotation.

## Snapshot and errors

Run routes return a direct JSON object with `runId`, `accountId`, `lifeIndex`, `seed`, `simulationVersion`, `generatorVersion`, `configId`, `state` (the complete simulation `State`), `status`, `verificationStatus`, `deliveryStatus`, `checkpointSequence`, `writerGeneration`, `activeTicks`, `activeTickLimit`, and RFC3339 `submissionDeadline`; `completionReason` and `writerToken` are present when applicable. Status is `active`, `completion_pending`, `completed`, `rejected`, or `abandoned`. `verificationStatus` is `in_progress`, `verified`, or `rejected`; `deliveryStatus` is `not_ready`, `pending`, `delivered`, or `rejected`. Errors use `{"error":{"code":"...","message":"..."}}`. A foreign run ID is indistinguishable from a missing run (`404`).

## `POST /api/v1/runs/{run_id}/abandon`

Body is `{"writerGeneration":1,"writerToken":"..."}`. Records an owner-requested abandonment. It never creates an earning or completion event. Returns the updated snapshot. A stale writer cannot abandon after takeover.

## Platform completion event

A verified replay result creates a durable outbox event sent to `POST /internal/v1/run-completions` with `Authorization: Bearer CORE_TO_PLATFORM_TOKEN`. The event is `RunLifeCompleted.v1` with `event_id`, `account_id`, `run_id`, `life_index`, simulation/generator/config identity, checkpoint sequence, score, `{FEATHER,GAME_STAR}` collections and `reason` (`death` or `flight_cap`), and RFC3339 `completed_at`. The run is already `completed` with `verificationStatus: verified` while this delivery is pending; permanent delivery rejection is reported separately and does not invalidate replay verification. This records verification only; it does not issue currency.

## Health and outage operations

`GET /healthz` reports process health; `GET /readyz` reports PostgreSQL and platform-delivery configuration readiness without exposing secrets. Operator outage commands are authenticated separately and persist service outage intervals. They extend submission deadlines only for runs whose one-hour deadline overlaps a recorded outage, through outage recovery plus one hour. Clients cannot request or create outage extensions.
