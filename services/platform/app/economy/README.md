# Economy boundaries

The Economy module stores verified run-completion evidence in `models.py`.
Evidence is not a balance change or reward. The internal `wallet/` package
provides account/currency balance projections, immutable signed ledger entries,
transactional idempotent posting, linked adjustments, and read-only paginated
reconciliation. It has no routes or issuance callers. Currency issuance,
settlement, purchases, and account inventory remain disabled.

Run-completion verification maps simulation identity `3.2.0` / `3.2.0` /
`dd-v3-curved-pipes-v1` (catalog 13) to policy
`verified-pickups-v15-curved-pipes`. Issued catalog-12 runs retain simulation
identity `3.1.0` / `3.1.0` / `dd-v3-varied-base-v1` and policy
`verified-pickups-v14-varied-base`. Issued catalog-11 runs retain the
`3.0.0` / `dd-v3-base-bonus-v1` identity and v13 policy; catalog-10 runs retain the
`2.9.0` / `dd-v2-dense-pipes-v1` identity and v12 policy; catalog-9 runs retain the
`2.8.0` / `dd-v2-pressure-pipes-v1` identity and v11 policy; catalog-7 runs retain the
`2.6.0` / `dd-v2-bonus-segments-v2` identity and v9 policy; catalog-6 runs retain the
`2.5.0` / `dd-v2-bonus-segments-v1` identity and v8 policy; catalog-5 runs retain
`2.4.0` / `dd-v2-coin-course-v1` and v7 policy. These policy mappings do not
establish PostgreSQL settlement integration or gameplay acceptance.

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
