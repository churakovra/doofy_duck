# Go simulation implementation

> Historical `foundation-2` implementation checkpoint. Current arcade mechanics
> are in [Arcade simulation](ARCADE_SIMULATION.md); the shared
> [fixture contract](../contracts/simulation/README.md) records current identities.

The standalone standard-library Go module is `services/core/simulation` (`module doofyduck/simulation`). It implements the frozen `foundation-2` rules as a pure native library; it is not an HTTP service and has no database, broker, auth, wallet, or payment integration.

## API

- `CreateRun(descriptor, config) (State, error)` validates identities/configuration and produces the three default opening pipes.
- `Step(state, frames) (Result, error)` advances one fixed 60 Hz tick; `Result` contains the complete next `State` and ordered typed `Events`.
- `GenerateNext`, `Pause`, `Resume`, and `Restart` provide the corresponding lifecycle/generation operations.
- `Mix32`, `ValidateConfig`, `ConfigIDFor`, and `CanonicalJSON` expose deterministic primitives and validation.

Gameplay coordinates and velocities use `int64` milli-pixels. Seeds and RNG state use 32-bit unsigned wraparound. State counters are checked against `Number.MAX_SAFE_INTEGER-1`; configuration weight sums retain the TypeScript safe-integer bound. Config slices, state slices, and maps are copied at API boundaries to avoid mutating prior states through returned values.

Custom configuration IDs embed canonical JSON of `{configuration, patterns}` (sorted object keys, ordered arrays). The mutable package variables `DefaultConfig` and `Catalog` are intentionally not exported. Use `DefaultConfiguration()` and `PatternCatalog()` to obtain independent copies; edits to those values cannot change the canonical process-wide rules. Custom configuration IDs use the private canonical pattern catalog. `CanonicalJSON` accepts integer values only in the JavaScript safe-integer domain and rejects fractions, exponent-form numbers, and unsafe magnitudes. Config validation checks every numeric field against that same domain before derived arithmetic. The fixture verifier compares marshaled actual results to raw expected JSON using `UseNumber` and sorted object keys; expected states/events are never normalized through runtime structs, and every operation must include both expected fields.

## Verify

From this directory:

```sh
go test ./...
go test -race ./...
go vet ./...
test -z "$(gofmt -l *.go)"
```

`TestFoundation2FullFixtureParity` parses `contracts/simulation/golden-v1.json`, verifies all nine raw initial states, replays all 24 operations (including 24,200 aggregate advance ticks and the 24,000-tick seed-3 run), compares every complete raw expected state and ordered event array, and requires all five invalid cases to reject. It also requires all four mixer vectors; the fixture revision and cardinalities fail visibly if the contract shrinks.

Run that parity test alone with:

```sh
go test -run TestFoundation2FullFixtureParity -v
```
