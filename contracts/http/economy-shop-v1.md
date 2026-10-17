# Economy cosmetic shop v1

These authenticated routes use the Platform EdDSA bearer token described in
[account-auth-v1.md](account-auth-v1.md). The token subject is the sole account
selector. Every route is served by Platform and uses only the Economy database;
Platform does not look up account ownership in another service.

## Catalog

`GET /api/v1/shop/catalog` is readable while the shop mutation gate is off. The
response includes both the catalog version and `enabled`, which controls whether
new quotes, equipment changes, and purchases can be submitted. Each item's
`available` field describes its offer, independently of the feature gate.

```json
{
  "catalog_version": "cosmetics-v1",
  "enabled": false,
  "items": [
    {
      "item_type": "skin",
      "item_id": "classic",
      "display_name": {"en": "Classic", "ru": "Классика"},
      "asset_id": "classic",
      "default": true,
      "available": true,
      "price": null
    },
    {
      "item_type": "skin",
      "item_id": "mint",
      "display_name": {"en": "Mint", "ru": "Мята"},
      "asset_id": "mint",
      "default": false,
      "available": true,
      "price": {"currency": "FEATHER", "amount": "20"}
    }
  ]
}
```

The complete immutable `cosmetics-v1` catalog is:

| Type | ID | Price |
| --- | --- | --- |
| skin | classic | free default |
| skin | mint | 20 FEATHER |
| skin | rose | 200 FEATHER |
| skin | celestial | 100 GAME_STAR |
| skin | royal | 200 GAME_STAR |
| background | meadow | free default |
| background | dusk | 20 FEATHER |
| background | winter | 200 FEATHER |
| background | nebula | 100 GAME_STAR |
| background | aurora | 200 GAME_STAR |

Amounts and wallet balances are decimal strings. The stable `asset_id` is a
renderer lookup hint; a missing asset uses the renderer's safe fallback and does
not grant ownership or affect gameplay.

## Inventory and equipment

`GET /api/v1/shop/inventory?limit=100&cursor=...` returns only the token
subject's permanent entitlements, ordered by `(item_type,item_id)` ascending.
`limit` is 1 through 100 and `cursor` is an opaque, bounded keyset cursor. The
response has `{ "items": [...], "next_cursor": null }`; each item contains
`item_type`, `item_id`, `grant_kind`, `catalog_version`, and `granted_at`.

`GET /api/v1/shop/equipment` returns the independent skin and background
selection rows:

```json
{
  "equipment": [
    {"item_type": "skin", "item_id": "classic", "revision": 1},
    {"item_type": "background", "item_id": "meadow", "revision": 1}
  ]
}
```

Inventory and equipment reads idempotently provision the approved free
entitlements and initial selections in a short Economy transaction. This
bootstrap grants no currency and works while shop mutations are disabled.

`PUT /api/v1/shop/equipment/{item_type}` changes one selection. The body is
`{"item_id":"mint","expected_revision":1}`. A successful response returns
the selected `item_type`, `item_id`, and new `revision`. Skin and background
changes are independent; the API does not promise an atomic pair update. A stale
revision returns 409 with the current row nested under `detail.current`:

```json
{"detail":{"code":"stale_equipment","message":"equipment changed","current":{"item_type":"skin","item_id":"rose","revision":2}}}
```

Only an owned item of the requested type can be equipped. Known IDs in another
category return 409 `wrong_item_type`; known but unowned IDs return 409
`item_not_owned`; unknown IDs return 404 `item_not_found`. Owned items remain
equippable if their offer is later delisted.

## Quotes and purchases

`POST /api/v1/shop/quotes` accepts exactly
`{"item_type":"skin","item_id":"mint"}`. It returns a persisted,
account-bound quote with a five-minute lifetime:

```json
{
  "quote_id": "7a9d5f88-8adf-4eb8-b224-578071e71461",
  "catalog_version": "cosmetics-v1",
  "eligibility_version": "telegram-account-v1",
  "item_type": "skin",
  "item_id": "mint",
  "currency": "FEATHER",
  "amount": "20",
  "created_at": "2026-10-17T12:00:00Z",
  "expires_at": "2026-10-17T12:05:00Z"
}
```

The server supplies price, currency, eligibility and expiry. Authenticated
Telegram accounts meet the current eligibility rule; no tasks or prior payment
are required. Free defaults cannot be quoted. XTR and purchased-currency funding
are not available in this API.

`POST /api/v1/shop/purchases` accepts exactly `{"quote_id":"<UUID>"}` and a
required `Idempotency-Key` header containing 1–128 trimmed characters. Success
returns the immutable committed purchase plus the account's current balance in
the purchase currency:

```json
{
  "purchase": {
    "purchase_id": "7a9d5f88-8adf-4eb8-b224-578071e71461",
    "quote_id": "e0dbad29-8b72-4bf2-8fb3-1c4f36b287c9",
    "item_type": "skin",
    "item_id": "mint",
    "currency": "FEATHER",
    "amount": "20",
    "catalog_version": "cosmetics-v1",
    "status": "committed",
    "created_at": "2026-10-17T12:01:00Z"
  },
  "current_balance": "42"
}
```

The purchase atomically revalidates the quote and offer, locks the wallet,
debits the ledger, grants permanent ownership, and records the purchase. A
purchase never equips an item. An exact retry returns the original purchase even
after quote expiry, catalog changes, or the shop gate closing; `current_balance`
is freshly read and may differ from the original response. Reusing a key with a
different quote returns 409 `idempotency_conflict`.

`GET /api/v1/shop/purchases/lookup?idempotency_key=...` resolves an uncertain
operation by account-scoped key. `GET /api/v1/shop/purchases/{purchase_id}`
reads one owned purchase. `GET /api/v1/shop/purchases?limit=50&cursor=...`
returns a bounded account-owned history ordered by `(created_at,id)` descending.
Lookup and history responses include the purchase and a freshly read
`current_balance` string in its currency. A missing or foreign quote or purchase
returns 404.

## Errors and persistence

Shop errors use FastAPI's standard envelope:

```json
{"detail":{"code":"insufficient_funds","message":"wallet balance is insufficient"}}
```

Disabled mutations and unavailable Economy state return 503, with codes
`shop_disabled` and `shop_unavailable`. Invalid request shapes return 422.
Stable 409 codes include `expired_quote`, `stale_quote`, `already_owned`,
`insufficient_funds`, `wrong_item_type`, `item_not_owned`, `stale_equipment`,
and `idempotency_conflict`. Foreign and missing account-owned resources are both
404.

Catalog and offer versions are immutable code data; any price or offer change
requires a new version. Economy persistence consists of unique account/item
entitlements with grant provenance, one revisioned equipment row per account
and item type, immutable account-bound quotes, immutable purchase results, and
an account/idempotency-key reservation with a deferred foreign key to its
purchase result. A failed transaction rolls all of these records and the wallet
debit back together. No route provides arbitrary currency credit, refunds,
payments, or support adjustments.
