# Native Go simulation

This directory is a standalone standard-library Go module, not an HTTP service.
`simulation.go` independently implements the TypeScript rules and verifies shared
raw JSON fixtures. Read [current rules](../../../docs/ARCADE_SIMULATION.md) and the
[contract](../../../contracts/simulation/README.md) before changing behavior.

- Match TS integer/range constraints, indexed generation, RNG advancement,
  lifecycle, config identities, state fields, and event serialization.
- Keep canonical data private and return defensive copies of mutable structures.
- Compare expected fixture JSON raw; do not normalize expected messages through
  runtime structs in a way that masks missing fields or serialization differences.
- Mirror intended behavior changes in TypeScript. Review schema, identities, and
  fixtures together; do not regenerate fixtures to make a mismatch disappear.

From the repository root: `npm run test:go`, `npm run test:parity`,
`npm run test:go:race`, and `go -C services/core/simulation vet ./...` cover native
and shared behavior. Use `gofmt` for edited Go files.
