# Native simulation benchmarks

Run the deterministic native Go benchmarks from the repository root:

```sh
go -C services/core/simulation test -run '^$' -bench 'BenchmarkDefault(Step|Replay300Ticks)$' -benchmem -count=3
```

The one-step cases benchmark `Step` from an already-running default run. Each
iteration receives the same immutable state: either no input or one accepted
FLAP, so the benchmark isolates one active default-config transition and its
copying/allocation cost. The replay case pre-authors a 300-tick FLAP schedule
outside the timer using seed 42 and the default configuration. Its controller
steers toward the nearest upcoming generated gap. Setup and schedule validation
are outside the timed loop; each measured iteration replays every operation
from a fresh READY state. The workload reaches tick 300 in RUNNING with score 3
and final-state SHA-256 fingerprint
`dbdd3d35bea3b1abffb48369a1fb0ef499b094932ff0232aee10b5757b8833be`.
The test builds the schedule twice and checks its final fingerprint, phase,
tick, and score. There is no post-death inert loop in the replay.

Recorded on 2026-10-14 with Go 1.27.2, darwin/arm64, Apple M4, macOS 27.0.1. The
exact command above was run with `GOCACHE=/private/tmp/doofy-refactor-go-cache`.

| Workload | ns/op across three runs | B/op | allocs/op |
| --- | --- | ---: | ---: |
| Step without flap | 521.0, 530.3, 525.9 | 1712 | 12 |
| Step with flap | 591.2, 606.1, 555.3 | 1712 | 12 |
| 300-tick active replay | 212269, 201717, 202042 | 721823–721828 | 4428 |

The three samples show run-to-run variation on this host; they are a local
baseline, not a capacity guarantee or a cross-machine comparison. Re-run on the
target hardware when comparing changes.

## Copy reduction — October 18, 2026

The current 1.4.0 simulation was measured before and after removing the second
deep state/configuration copy inside `Step`. Public `GenerateNext` still copies
its input; only the internal call from the already-owned step state skips it.
Rules, fixture expectations and public mutation isolation remain unchanged.

On Apple M4, darwin/arm64, using the same workloads with
`-benchtime=500ms -count=3`, the allocation costs changed as follows:

| Workload | Before | After |
| --- | --- | --- |
| Step, with or without flap | 8,960 B / 64 allocations | 7,544 B / 44 allocations |
| 300-tick active replay | approximately 2.96 MB / 20,904 allocations | approximately 2.48 MB / 14,339 allocations |

These before/after measurements use the current challenge and Star scheduling
rules. The October 14 timing baseline above used earlier rules and cannot
establish a comparable timing regression. The allocation reduction does not
establish hosted capacity or browser frame performance.
