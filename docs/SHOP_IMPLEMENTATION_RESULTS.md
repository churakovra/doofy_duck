# SHOP implementation record

October 17, 2026. This records the item 6 code delivery and its WALLET prerequisites.
It is not production activation or hosted acceptance.

## Delivered code

- Account-owned wallet balances and paginated ledger history with decimal-string
  amounts, immutable entries, idempotency, atomic projections and reconciliation.
- Durable completion settlement independent of Core receipt delivery. Coins credit
  1:1 up to 30 per run; the approved new simulation credits collected in-game Stars
  1:1 without a seven-Star ceiling. Legacy Star facts are not credited.
- Explicit activation cutoff, bounded historical coin-only backfill for supported
  profiles, dry-run cursors, actionable-failure recovery, worker and read-only audit.
- Approved catalog: Classic/Meadow defaults; Mint/Dusk 20 coins; Rose/Winter 200
  coins; Celestial/Nebula 100 in-game Stars; Royal/Aurora 200 in-game Stars.
- Account inventory, idempotent starter grants, independently revisioned skin and
  background equipment, ownership enforcement and stable cosmetic IDs.
- Account-bound five-minute quotes and atomic wallet debit, entitlement grant and
  immutable purchase record. Exact retries recover the original purchase after
  expiry or gate closure; new quotes cannot override server prices.
- Bilingual account shop with previews, prices, confirmation, purchase recovery,
  balances and settlement states. Account equipment is separate from practice.
- TypeScript/Go Star generation under 1.4.0/1.3.0/dd-v1-star-interval-v1:
  seeded collectible intervals of 8–16 pipes, actual collection required, bounded
  capacity, and preserved replay for legacy 1.3.0/1.2.0/dd-v1-stepped-v1.
  No scripted death or score ceiling was added.

Permanent cosmetic ownership and no self-service internal-currency refunds are
approved. Support corrections require audited adjustments. XTR funding, payment
refunds, paid continue, gifts and real-money redemption remain outside this slice.
New premium palettes are test visuals, not approved launch artwork.

## Activation and acceptance boundaries

Settlement and shop mutation flags default off. No retained player facts have been
backfilled and no production activation or deployment has been performed.
See the [wallet contract](../contracts/http/economy-wallet-v1.md), [shop contract](../contracts/http/economy-shop-v1.md)
and root [operating commands](../README.md).

The owner explicitly requested no further Docker/database tests. New PostgreSQL
regressions are written but the final wallet/shop database suite is unrun.
Earlier 22-test and 39-test PostgreSQL passes apply to their earlier milestones;
they are not evidence for the final shop/Star-settlement implementation.
The first shop integration run had unresolved failures before subsequent code
fixes; those fixes await database verification.

Browser suites were not requested. Real Telegram/device checks, mixed gameplay
and purchase capacity, complete outage/reconnect acceptance, migration/rollback
drills and managed synchronous failover remain open. The prior one-hour
1,000-flight pass is steady-gameplay foundation evidence, not a final shop test.
Typical deaths around scores 50–70 remain a human playtest/tuning target.

## Local verification

The integrated tree passed TypeScript checks, ESLint, 334 unit/fixture tests
across 34 files, native Go simulation tests, Go simulation race/vet, Core
unit/race/vet and the production build. The routine command stopped at a sandbox
Go-cache permission error after TypeScript/lint/unit checks; the remaining Go
checks and build were then run successfully with a writable Go cache. Application
tests were not repeated merely to work around that environment issue.

Python: formatting, Ruff, strict mypy (22 source files), and all 11 non-database
tests passed. The native Python invocation explicitly skipped 45 database cases;
these skips are not passing integration evidence. New database regressions remain
unexecuted under the owner's no-Docker/no-database-test instruction.

Independent reviews and targeted re-reviews covered simulation parity/legacy
recovery, transaction/ownership/settlement, and UI purchase/account lifecycle.
Findings were fixed by the original implementation owners with regression tests.
The existing large JavaScript chunk warning remains.

Integration branch: feature/shop-integration. Backend commit 59adefa, simulation
integration commit 8d83496 (feature commit 0bca55f), UI integration commit 22c38ac
(feature commit ae44f44).
