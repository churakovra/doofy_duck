# Wallet and progress

The game uses an account wallet. Core verifies runs and delivers completion facts
to the Economy inbox. A settlement worker credits eligible pickups to the ledger.
Pending rewards are not spendable. Local startup enables settlement unless an
existing setting disables it. Production activation is separate.

The account wallet stores coins (`FEATHER`) and in-game Stars (`GAME_STAR`).
Neither currency is Telegram Stars (`XTR`). The
[wallet contract](../contracts/http/economy-wallet-v1.md) defines settlement,
idempotency and API behavior. The [operations runbook](BACKEND_OPERATIONS.md)
covers worker operation and recovery.

`apps/web/src/local-progress.ts`, `wallet.ts` and `wallet-session.ts` are legacy
local helpers. The account game does not use their balances as account funds and
does not import earlier browser balances. See the [code map](ARCHITECTURE.md)
for the account flow and the [root README](../README.md) for current commands.
