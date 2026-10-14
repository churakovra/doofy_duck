# Parent core stabilization evidence

Status: implemented and locally checked; independent review and native Go parity pending. This supersedes prior partial core handoff limitations where specifically resolved below. No version release or real Telegram/device evidence is claimed.

## Observed regression cycles

All commands ran in the project root using `npm test -- packages/game-sim/test/stabilization.test.ts` with the relevant `-t` filter, except the fixture check in fixtures.test.ts.

| Behavior | Actual RED | GREEN after smallest change |
|---|---|---|
| Seeded authored map |16 seeds yielded only1 layout; expected >1 | Block-level seed mixer chooses authored pattern; reproducibility and variation pass |
| Immutable configuration identity | Changed gravity under dd-v1-default did not throw | configIdFor binds exact canonical config+catalog content; mismatched default alias rejects |
| Actual NONE bucket | Positive-weight FEATHER spawned despite a draw in NONE | Explicit NONE short-circuit; regression returns no item |
| Required numeric fields/placement | Missing spacing, missing duckX and oversized pickup radius all accepted | Required-field iteration and pickup clearance validation reject all three |
| Lifetime safety | Tick at Number.MAX_SAFE_INTEGER stepped without rejection | Checked counter increments reject before imprecision |
| Default opening |9 of16 seeds died under the declared surviving-controller test | Lead-in changed240000→420000; all16 survive24000ticks |
| No eligible item | Zero NONE weight plus not-yet-eligible types threw | Consume opportunity as NONE with RNG cursor advancement |
| Stale golden rules | Fixture firstPipeX240000 differed from live420000 | Reviewed semantic assertions plus regenerated complete foundation-2 fixtures; executable replay passes |

## What is now executable

-65 unit/contract test cases across4 files passed at the parent checkpoint.
-Root typecheck, lint and build:sim passed.
-Nine shared cases replay complete canonical state and ordered events; five rejected-input cases and mixer vectors also run in TypeScript.
-Sixteen default-config seeds each survived exactly24000 ticks, asserting RUNNING and live-array bounds. The seed3 fixture ends with261 pipe points.
-A closed vertical control orbit is observed from tick115 through219 (period104). Its y-range227440..335600 lies strictly inside the common safe center interval222000..338000. The first possible pipe contact is tick93; the prefix also stays inside this interval. This supplies a default-physics surviving strategy for every catalog transition, not safety for all inputs/custom configs.
-Coordinates remain window-relative, so rebasing an accumulated distance coordinate is unnecessary; safe-integer guards cover lifetime counters. No heap/leak or unlimited-lifetime claim follows from finite tests.

Fixture SHA256 at dispatch: a0f2f19e31f3944491d9bb71647ac41ff2535cbe5e2684e2d5ab2daf022350a7. This is a real shasum result, not a security approval. Shared contract and native-port instructions are in contracts/simulation/README.md.

## Pending acceptance

Independent core review; native Go implementation/parity/race/vet; frontend viewport and pause/input review fixes; integrated browser retest; physical Telegram/mobile and measured performance evidence. Full simulation configuration validation is not a general reachability solver. No live currency, account wallet, payment, gift operation or commercial release is enabled.
