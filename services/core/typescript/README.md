# TypeScript Core

TypeScript Core is the default local run service. The Go implementation remains available for comparison and rollback. Production capacity and real Telegram acceptance remain open.

The service uses the existing Core schema and the shared TypeScript simulation.
Run `npm run build:core:typescript` to compile it. Configure `CORE_DATABASE_URL`
first, then run `node services/core/typescript/dist/migrate-main.js` against the
intended database. Configure `ACCESS_TOKEN_PUBLIC_KEYS_JSON`,
`CORE_PLATFORM_COMPLETION_URL`, `CORE_TO_PLATFORM_TOKEN` and
`CORE_OPERATOR_TOKEN` before starting
`node services/core/typescript/dist/main.js`. The local Compose stack uses this
Dockerfile. `deploy/compose.go.yaml` restores the retained Go service for
comparison or rollback.

Run `npx vitest run services/core/typescript/test` for unit tests. Set
`CORE_TEST_DATABASE_URL` to a dedicated PostgreSQL test database to enable the
integration tests; they create and drop a uniquely named schema. These tests are
not a substitute for full cross-service, load, and recovery acceptance.
