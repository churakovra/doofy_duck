# Economy boundaries

The current Economy module stores verified run-completion evidence in
`models.py`. Evidence is not a balance change or reward. Currency issuance,
purchases, and account inventory are disabled.

The `inventory` package is reserved for future account-owned item ownership and
inventory rules. The `shop` package is reserved for future catalog and purchase
orchestration. These packages only document ownership boundaries; they contain
no routes, persistence models, balances, or purchase behavior.
