# Economy boundaries

The Economy module stores verified run-completion evidence in `models.py`.
Evidence is not a balance change or reward. The internal `wallet/` package
provides account/currency balance projections, immutable signed ledger entries,
transactional idempotent posting, linked adjustments, and read-only paginated
reconciliation. It has no routes or issuance callers. Currency issuance,
settlement, purchases, and account inventory remain disabled.

Wallet currency values are `FEATHER` and `GAME_STAR`, each represented as an
integer balance in the range 0 through the signed 64-bit maximum. A posting
records its source kind/reference and policy version; callers own the transaction
and may combine postings with future Economy work in one commit. The database
rejects ledger updates and deletes. Migration downgrade deletes wallet history
and is for disposable development databases only.

`app.economy.wallet.ledger.reconcile_wallets` reports ledger sums against the
balance projection in bounded pages. It uses one SQL statement per page and
never repairs data.

The `inventory` and `shop` packages provide account-owned cosmetic defaults,
inventory and equipment, versioned quotes, and atomic internal-currency
purchases. Shop writes remain disabled by default. Purchase settlement and
historical coin backfill are separate operator-controlled paths; the read-only
`wallet-audit` settlement CLI command reports projection discrepancies without
repairing them.
