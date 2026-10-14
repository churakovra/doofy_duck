# Shared simulation contract

Read [README.md](README.md) and the [current rules](../../docs/ARCADE_SIMULATION.md).
`golden-v1.json` contains reviewed expected full states/events. The descriptor
schema is a consumer contract. Both TS and Go implementations depend on this path.

- Keep expectations independent of test execution. The fixture producer imports
  TypeScript; independent Go replay and semantic assertions provide extra checks.
- Run the producer only for a deliberate reviewed rules/contract update. Inspect
  the resulting diff, identities, both implementations, and schema compatibility.
- Never run fixture generation automatically from tests or erase a mismatch by
  accepting the implementation's new output without explaining the rule change.

From the repository root, `npm run test:parity` verifies committed expectations.
The explicit maintenance command, when needed, is `npm run build:sim` followed by
`node contracts/simulation/generate-fixtures.mjs`.
