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
