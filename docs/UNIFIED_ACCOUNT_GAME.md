# Unified account game

October 18, 2026. The owner requested one game across local development and
Telegram, replacing the optional browser-practice/account split. Authentication
controls described below were subsequently superseded by
[automatic launch identity](TELEGRAM_BOT_SETUP.md); its verification evidence is
recorded separately.

## Delivered behavior

- The game entry always opens the account-backed flow. There is no anonymous
  practice selector or return-to-practice action.
- Local startup connects a persistent development Telegram identity. Real
  Telegram launch data takes precedence; production development auth is disabled.
- The same settings, simulation, verified-run recovery, account shop, wallet and
  equipment paths serve both environments. Equipment appears on home, flight and
  result scenes. Sign-out remains explicit and does not immediately sign back in.
- `make run` starts PostgreSQL, account/run services, the local gateway, the
  continuous settlement worker and Vite. `make run-account` aliases it.
- Existing credentials, database data and explicit economy settings are retained.
  Missing local economy settings are added once with a UTC activation cutoff.
  Verified coins and in-game Stars credit the account under the existing policy;
  browser-only balances and pre-cutoff facts are not imported automatically.
- Production authentication and economy activation stay explicit and fail closed.
  This change does not activate production settlement or deploy the application.

## Verification

The routine `npm run check` passed with a writable temporary Go cache: TypeScript,
ESLint, 339 unit/fixture tests across 38 files, Go simulation tests and production
build. The existing large JavaScript chunk warning remains.

No pre-implementation failing-test run was recorded for this milestone; the
required red-before-green sequence was not demonstrated. The initial integration
check exposed obsolete practice assumptions and a timing-sensitive retry test;
those were corrected before the passing routine run.

Focused verification covered automatic development login, Telegram precedence,
production auth gating, retries, logout fencing, modal input blocking, live locale
changes and equipped appearance across scenes. Three deployment helper tests
passed, including preservation of explicit settings/cutoff and accepted boolean
forms for the settlement worker. Independent review found two issues in worker
boolean parsing and idle-scene equipment; both were fixed with regression tests.

A rendered production Compose configuration confirmed development authentication
and economy mutation gates disabled, development frontend authentication disabled,
and the local settlement service excluded. This was configuration inspection,
not a production deployment.

The local stack was built and started against the retained PostgreSQL volume.
Platform and PostgreSQL were healthy; Core, gateway, static web and settlement
worker were running, with Vite at `http://127.0.0.1:4173/`.

The cross-service smoke passed against the real local PostgreSQL stack: separate
account ownership, Go replay of an actual simulated pickup, positive wallet
settlement by the background worker, enabled shop/starter equipment reads, wallet
and equipment persistence after re-login, and exactly one stored completion
receipt. It used disposable development identities and did not fabricate ledger
credits.

Browser suite source now uses a mocked Telegram account API, with account-run,
wallet and recovery assumptions replacing anonymous practice setup. TypeScript
and ESLint passed again after those test-source changes.
Browser suites, real Telegram/device acceptance, full database regression suites
and hosted deployment have not been run for this milestone.

Local diagnostic logs: `/tmp/duffy-unified-startup.log`,
`/tmp/duffy-unified-check.log`, `/tmp/duffy-unified-smoke.log`, and
`/tmp/duffy-unified-refresh.log`. These are temporary
local files, not retained CI or hosted acceptance evidence.
