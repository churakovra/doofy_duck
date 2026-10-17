# Account and service authentication v1

The Platform API and Core use one browser origin. `POST /api/v1/runs` and
`/api/v1/runs/*` are routed to Core; other `/api/*` requests go to Platform.
Platform owns account records and refresh sessions. Both services independently
verify the Ed25519 access token; an account ID supplied in a header or body never
changes the authenticated subject.

## Browser authentication

`POST /api/v1/auth/telegram` accepts `{ "init_data": "<Telegram WebApp initData>" }`.
Platform checks Telegram's HMAC-SHA-256 signature and `auth_date` freshness
(maximum age 10 minutes, maximum future skew 30 seconds). Success returns
`{ "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 600 }` and
sets a 30-day rotating `dd_refresh` HttpOnly cookie scoped to `/api/v1/auth` plus a
readable `dd_csrf` cookie scoped to `/`. Both are SameSite=Lax; `Secure` is set in
production. Refresh and logout require `X-CSRF-Token` to match the CSRF cookie.

`POST /api/v1/auth/refresh` rotates the refresh cookie and CSRF token and returns
a new access token. Reuse of a previously rotated token revokes its entire session
family and returns 401. `POST /api/v1/auth/logout` revokes the current refresh
session and clears both cookies. Invalid authentication data returns a generic
401; invalid CSRF returns 403.

`GET /api/v1/account` requires a bearer token and returns only the authenticated
account: `{account_id, telegram_user_id, created_at}`. `GET
/.well-known/jwks.json` publishes the current public signing key using the standard
OKP/Ed25519 JWK shape.

## Access-token wire format

Compact JWT, signed with Ed25519 (`alg: EdDSA`). Header:

```json
{"alg":"EdDSA","typ":"JWT","kid":"<configured-key-id>"}
```

Claims:

```json
{
  "iss":"doofy-platform",
  "aud":"doofy-core",
  "sub":"<canonical account UUID>",
  "iat":<Unix seconds>,
  "exp":<iat plus 600 seconds>,
  "jti":"<random UUID>",
  "scope":["run:write"]
}
```

Core verifies signature using `kid`, exact issuer/audience, subject UUID, `iat`,
`exp`, maximum 600-second lifetime, and the `run:write` scope. Public keys are
configured as `ACCESS_TOKEN_PUBLIC_KEYS_JSON`, a JSON object mapping each key ID
to base64url-encoded raw 32-byte Ed25519 public key. Platform signs with raw
32-byte private key in `ACCESS_TOKEN_PRIVATE_KEY_B64`; rotate by publishing the
new key and retaining old public keys until issued credentials expire.

## Local development authentication

`POST /api/v1/auth/dev` accepts `{ "telegram_user_id": <positive integer> }` and
returns the same access-token response and cookies. It exists only when
`DD_ENV=development` and `DEV_AUTH_ENABLED=true`; Platform startup rejects this
combination in production. Never enable it on a public deployment.

## Core completion inbox

Core sends `POST /internal/v1/run-completions` with
`Authorization: Bearer <CORE_TO_PLATFORM_TOKEN>`. This route is available only on
the internal Compose network; the public gateway returns 404 for `/internal/*`.
The `RunLifeCompleted.v1` JSON shape is defined in
[`../events/run-life-completed-v1.schema.json`](../events/run-life-completed-v1.schema.json).
Platform stores verified evidence without issuing currency. `(run_id, life_index)`
and `event_id` are unique. A replay with identical canonical payload returns
202 and `duplicate: true`; conflicting evidence returns 409.
