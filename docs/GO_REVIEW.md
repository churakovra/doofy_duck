# Go simulation independent review

**Verdict: `passed: false`.** Initial-source review (the workspace has no Git metadata, so there is no revision diff/baseline). Production implementation files and fixtures were not modified.

## Findings (priority order)

1. **[High] Exported catalog is mutable and can crash the public API** — `services/core/simulation/simulation.go:130,306-320`. `Catalog` and `DefaultConfig` are exported mutable package variables, unlike the recursively frozen TypeScript exports. Setting the publicly exposed `Catalog = nil` leaves `ValidateConfig` successful; `CreateRun` then panics in `GenerateNext` at `choice % len(Catalog)` (observed: `runtime error: integer divide by zero`). Mutating catalog entries also changes pattern selection/config identity process-wide; mutating `DefaultConfig.Collectibles` changes future defaults. Keep canonical tables private/immutable or defensively validate/copy them before use.

2. **[High] `abs(math.MinInt64)` overflow bypasses config range validation** — `simulation.go:177-181,213-217`. `abs(-1<<63)` overflows back to a negative value, so its `> 10_000_000` check is false. Reproduction with a copy of `DefaultConfig` and `bad.Flight.DuckX = -1 << 63`: Go `ValidateConfig(bad)` returns `nil`; TS `validateConfig` rejects the same value (`Math.abs` exceeds its bound). This admits out-of-range coordinates and causes Go/TS config-identity/behavior divergence; avoid negating before a bound check (or use checked absolute values).

3. **[Medium] Death-event totals both serialize incorrectly when empty and alias returned state** — `simulation.go:110-120,385-390`. `RunEnded.Totals` has `omitempty`, so an empty-but-present map serializes as absent, whereas the TS event includes `totals: {}` and the contract requires empty maps, not omitted values. Reproduction: create a run, set a synthetic running state with `Duck.Y = 0`, then `Step(s, nil)`; the event JSON was `[ {"type":"RunEnded","runId":"probe","score":0,"tick":1} ]` without `totals`. Additionally, the event map is the same map as `Result.State.Totals`: mutating `r.Events[0].Totals["mutated"]` changed `r.State.Totals` to include that key. TS state is frozen, so event consumers cannot mutate the returned state this way. Remove `omitempty` and copy/freeze event totals independently.

4. **[Medium] Exported Go `CanonicalJSON` accepts unsafe integers** — `simulation.go:219-265`. `CanonicalJSON(int64(9007199254740992))` returned `"9007199254740992", nil`; TS `canonicalJSON` now rejects that value under the safe-integer guard. This is a direct exported-helper contract mismatch. It does not invalidate parity for the currently tested safe-integer states, but the helper should reject numbers outside ±`Number.MAX_SAFE_INTEGER` (and document its supported value domain).

## Verification performed

- `cd services/core/simulation && go test ./... -count=1 -v` — passed, including full fixture parity.
- `go test -race ./... -count=1 && go vet ./...` — passed.
- Parsed `contracts/simulation/golden-v1.json` programmatically: **9 cases, 24 operations, 24,200 advance ticks, 5 invalid cases**; all 24 operations contain `expectedEvents`.
- Targeted exported-API probe run: `cd /Users/churakovra/.hermes/cache/scratch/go-sim-probe && go run .` — reproduced findings 1–4 above. Probe/module are outside the repository under Hermes scratch; no dependencies were installed.

No network/HTTP boundary was reviewed or inferred; findings concern the native simulation package and its public API only.
