# Telegram launch identity and first bot setup

October 18, 2026. Players open the game from Telegram and use that launch account
automatically. The app has no sign-in, test-account, logout or account-switching
controls. Local development automatically uses the configured development
identity. Each fresh Telegram launch uses the account that opened it; a saved
browser cookie must never silently choose another player.

## Create the bot

Open [@BotFather](https://t.me/BotFather) in your Telegram account and send
`/newbot`. Choose the display name and an available bot username. Store the token
privately on the backend; do not put it in the frontend, source control or chat.
The username is safe to share when coordinating setup.

The first Mini App test needs a bot and one reachable HTTPS origin serving both
the game and its `/api` routes. The localhost address on this computer cannot be
used by Telegram on another device. An HTTPS development tunnel to the local
gateway or a separately configured hosted environment can provide that origin.
This guide prepares the local path; no public tunnel or hosted deployment is
started automatically.

## Prepare the local real-Telegram configuration

Start with the normal local stack (`make run`) once so `.env.dev` and the
settlement cutoff exist. Stop its frontend with Ctrl-C when switching to the
static Telegram test build. Preserve existing database volumes.

Create a separate private environment file once:

```sh
cp -n .env.dev .env.telegram-test
chmod 600 .env.telegram-test
```

Edit the ignored `.env.telegram-test` locally and add
`TELEGRAM_BOT_TOKEN_REAL` with the token from BotFather. Keep `.env.dev` unchanged
so normal local development continues to work. Never print a resolved Compose
configuration with real credentials into a shared log.

Start the real-Telegram test configuration:

```sh
docker compose --env-file .env.telegram-test \
  -f deploy/compose.yaml -f deploy/compose.telegram-test.yaml \
  --profile local up --build -d
```

This configuration serves the static game and API at `http://127.0.0.1:8080/`.
It disables both frontend development sign-in and the backend development-auth
endpoint. It retains the local database and economy worker. The real bot token
is required; the generated placeholder is not a substitute. This is a local
integration configuration, not a production deployment.

Connect the selected HTTPS tunnel to port **8080**, which serves the single-origin
static game and gateway. Use the resulting HTTPS URL in BotFather. Do not expose
the ordinary Vite server or the default development-auth stack for this test.

## Configure the launch button

In BotFather, select the bot and configure its **Main Mini App** with the HTTPS
game URL. This adds the profile launch button and enables
`https://t.me/<bot_username>?startapp`. Optionally use `/setmenubutton` to add the
same URL as a Play menu button. A dedicated bot message handler is not needed
just to test the profile/menu Mini App launch.

Use the Main Mini App, menu button or an inline Web App button for this game's
authenticated launch. A reply-keyboard Web App button and inline mode do not
provide the same signed user launch data.

## Acceptance on Telegram

Open the bot's launch button while signed into your Telegram account. The game
should connect without account controls, start a run, verify a completed result
and show its settled wallet. Close and reopen it to check persistence. Launch
from a second Telegram account to verify that wallet, equipment and run ownership
remain separate. Test a second tab/device and explicit writer takeover.

Opening the HTTPS URL directly outside Telegram should explain how to open the
game from Telegram, even if that browser has an earlier account cookie. A
connection failure may offer Retry; expired Telegram launch data may require
closing and reopening the Mini App. Retry never selects a different identity.

When finished, close the tunnel and use `make stop` to stop the containers without
deleting data. `make run` restores the ordinary automatic local-development flow.
The test and normal local commands use the same Compose project/database volume;
run one configuration at a time.

## Sources and verification boundary

Checked against official Telegram documentation on October 18, 2026:
[bot creation](https://core.telegram.org/bots/features#botfather),
[Mini App launch methods](https://core.telegram.org/bots/webapps#launching-the-main-mini-app),
[menu buttons](https://core.telegram.org/bots/webapps#launching-mini-apps-from-the-menu-button),
[launch-data validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app),
and [HTTPS WebAppInfo](https://core.telegram.org/bots/api#webappinfo).
The backend validates signed `initData`; `initDataUnsafe` does not establish
identity. Bot creation and real Telegram/device acceptance require the owner's
Telegram account, a real bot token and an HTTPS origin and are not established
by local unit tests.

## Local verification for this change

`npm run check` passed after the final authentication fix: TypeScript, ESLint,
346 unit/fixture tests across 38 files and the production
build. The existing large-bundle warning remains. Five deployment-helper tests
passed, including both real-Telegram overlay checks using dummy credentials.
The local static web container was rebuilt; no real-bot configuration was started.

Tests were run red before implementing launch-authority/account-refresh changes,
the missing-token overlay and subsequent review fixes. Regression coverage includes
foreign-cookie bypass prevention, fixed local identity, frozen Telegram retries,
no account controls, preserved pending traces, rejection of foreign-account
refresh before purchase replay, no usable credentials before initial account
validation, bounded account lookup/refresh validation,
cancellation, lock release and ignored late responses. Independent review findings
were corrected by the same implementation owner and rechecked.

Browser suites, real Telegram/device checks and hosted deployment were not run.
No bot or HTTPS endpoint has been configured. Backend persistence code and
simulation behavior were unchanged; no database regression suite was run for
this frontend/configuration milestone.

Temporary local logs: `/tmp/duffy-launch-check.log` and
`/tmp/duffy-launch-web.log`. These are local evidence, not hosted acceptance.
