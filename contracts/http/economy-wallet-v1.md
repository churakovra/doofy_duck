# Economy wallet and settlement v1

These routes use the Platform EdDSA bearer token described in
[account-auth-v1.md](account-auth-v1.md). The authenticated token subject is the
only account selector. Wallet and completion-status reads return 503 when
durable state is unavailable; an unavailable wallet is never represented as a
zero balance. A stored actionable settlement failure remains an explicit status,
not a database-unavailable response.

## Wallet balances

GET /api/v1/wallets returns both supported account currencies:

```json
{
  "balances": [
    {"currency": "FEATHER", "balance": "42"},
    {"currency": "GAME_STAR", "balance": "0"}
  ]
}
```

Balances and entry deltas are base-10 strings so clients do not lose precision
above JavaScript's exact integer range. A successfully read currency with no
wallet row has a genuine zero balance.

## Wallet history

GET /api/v1/wallets/{currency}/entries?limit=50&cursor=... accepts FEATHER or
GAME_STAR, a limit from 1 through 100, and an optional opaque keyset cursor.
Entries are scoped to the authenticated account and ordered by (created_at,id)
descending. The next cursor resumes strictly after the last returned entry.

```json
{
  "entries": [
    {
      "entry_id": "7a9d5f88-8adf-4eb8-b224-578071e71461",
      "currency": "FEATHER",
      "operation_id": "completion:...",
      "delta": "3",
      "source_kind": "verified_completion",
      "source_reference": "...",
      "policy_version": "verified-pickups-v1",
      "correlation_reference": "...",
      "created_at": "2026-10-17T12:00:00Z"
    }
  ],
  "next_cursor": null
}
```

Invalid cursors return 400 invalid_cursor; invalid page limits or currencies are
rejected by request validation. There is no client credit or debit route.

## Completion settlement status

GET /api/v1/completions/{run_id}/{life_index} returns only a completion belonging
to the token subject. Missing or foreign completion identity returns 404.

```json
{
  "event_id": "7a9d5f88-8adf-4eb8-b224-578071e71461",
  "run_id": "79bb2291-c0f7-40a8-aa32-463019fad639",
  "life_index": 0,
  "status": "pending",
  "reason": "settlement_disabled",
  "policy_version": null,
  "credited": {"FEATHER": "0", "GAME_STAR": "0"},
  "completed_at": "2026-10-17T12:00:00Z"
}
```

Statuses are pending, committed, ineligible, and actionable_failure.
Pending, disabled, waiting, and actionable-failure amounts are not spendable.
Inbox acceptance and receipt acknowledgment commit independently of reward work.
Conflicting event or (run_id,life_index) identities return 409; identical
retries are acknowledged without creating a second settlement.

## Approved settlement policy

The gate defaults off. Enabling it requires both
ECONOMY_SETTLEMENT_ENABLED=true and an explicit timezone-bearing
ECONOMY_SETTLEMENT_ACTIVATED_AT timestamp. Live settlement considers the event's
verified completed_at, not its delivery time, against that cutoff. Older facts
stay pending with historical_backfill_required until the explicit backfill is
reviewed. Facts delivered after the cutoff but completed before it do not earn
live currency.

Policy verified-pickups-v1 accepts simulation 1.3.0, generator 1.2.0, config
dd-v1-stepped-v1. It credits verified FEATHER collections at 1:1 with a 30
FEATHER cap across all lives in a run. This legacy simulation identity does not
authorize GAME_STAR issuance; collected legacy Stars are recorded as uncredited
with reason legacy_star_generation.

Policy verified-pickups-v2-stars accepts simulation 1.4.0, generator 1.3.0,
config dd-v1-star-interval-v1. It credits verified FEATHER and GAME_STAR
collections at 1:1. FEATHER remains capped at 30 per run; GAME_STAR has no hard
settlement cap. Its ledger entries use policy version
verified-pickups-v2-stars.

Policy verified-pickups-v3-wetland accepts simulation 2.0.0, generator 2.0.0,
config dd-v2-wetland-v1. It preserves 1:1 FEATHER/GAME_STAR credit, the 30-coin
cap across lives and uncapped in-game Stars. Existing runs retain this policy.

Policy verified-pickups-v4-varied-obstacles accepts exactly simulation 2.1.0,
generator 2.1.0, config dd-v2-varied-obstacles-v1 for existing runs. Policy
verified-pickups-v5-paired-routes accepts exactly simulation 2.2.0, generator
2.2.0, config dd-v2-paired-routes-v1. Both preserve 1:1 FEATHER/GAME_STAR
credit, the 30-FEATHER run cap and existing Star rules; no cap migration is
required. Custom configurations and mismatched version/config tuples are
ineligible. Core issues the paired identity for new runs. Integration
verification is recorded in
[wetland challenges](../../docs/WETLAND_CHALLENGES.md).

Other simulation identities become actionable_failure and receive no currency.

Life indices settle in increasing order starting at zero. A later life remains
pending with waiting_for_prior_life until every lower index is committed or
ineligible. Settlement status, run cap and wallet ledger credits commit in one
Economy transaction. Row locks and business operation IDs make concurrent
workers, retries and process loss safe.

## Operator commands

Run one bounded worker batch:

```sh
cd services/platform
uv run python -m app.economy.settlement_cli settle --limit 100
```

The one-shot command does nothing while the gate is off. It reports safe JSON
counts and returns nonzero when actionable failures exist. For continuous
processing, `worker` requires settlement enabled and a configured activation
cutoff, commits each bounded batch separately, waits when the queue is empty, and
uses bounded exponential backoff after database errors. SIGINT and SIGTERM stop
it cleanly. Run it under an external process supervisor when continuous local
processing is needed:

```sh
cd services/platform
uv run python -m app.economy.settlement_cli worker --limit 100
```

The read-only wallet reconciliation command reports bounded pages and exits
nonzero when a projection differs from its ledger. It never repairs balances:

```sh
uv run python -m app.economy.settlement_cli wallet-audit --limit 100
```

Historical backfill is coin-only and capped at 30 per run. Dry run is the default:

```sh
cd services/platform
uv run python -m app.economy.settlement_cli backfill --limit 500
```

Applying a bounded page requires --execute, enabled settlement, an explicit
activation timestamp, and a nonproduction environment. Historical backfill
credits verified FEATHER only under the known 1.3.0 and 1.4.0 simulation
identities, at 1:1 with the same 30-per-run cap. Historical GAME_STAR pickups
remain uncredited under both identities. Unknown identities remain actionable.
The operation is idempotent and returns a continuation indicator when more facts
remain:

```sh
uv run python -m app.economy.settlement_cli backfill --limit 500 --execute
```

This operator command does not enable production settlement or run production
backfill. Existing local-practice balances and historical GAME_STAR collections
are never imported.
