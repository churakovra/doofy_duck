# Independent pure-core review

> Historical foundation review. The serializer finding was subsequently addressed
> in [Integration verification](INTEGRATION_VERIFICATION.md). Current rules and
> recorded checks are indexed in the [documentation map](README.md).

**Verdict: gameplay review passes for the documented default configuration; canonical serializer has a reproducible contract defect to resolve before treating it as a general canonical-JSON boundary.** No implementation or fixture files were changed. This workspace has no Git repository, so there is no revision baseline; review covered the complete exported core and current tests/contract files.

## Findings

### P2 — `canonicalJSON` emits invalid JSON for unsupported object values

At `packages/game-sim/src/index.ts:306-315`, primitive `undefined` is rejected, but object members are interpolated without checking whether recursive serialization returned a valid value. Reproduction:

```sh
node --input-type=module -e 'import {canonicalJSON} from "./packages/game-sim/dist/index.js"; console.log(canonicalJSON({a:undefined})); console.log(canonicalJSON({a:NaN}));'
```

Observed output: `{"a":undefined}` (not valid JSON), then `{"a":null}`. The contract describes canonical values as safe integers with no absent/null runtime fields (`contracts/simulation/golden-v1.json`, `rules.canonical`), so unsupported values should be rejected rather than serialized as malformed JSON or silently collapsed to `null`. This does **not** arise in the tested normal run states/config fields, which are validated; it is an exported-utility/API edge, not a reproduced default-gameplay failure. Add explicit recursive value validation and focused tests before relying on this helper for arbitrary cross-language payloads. If Go consumers implement the same helper contract, coordinate the rejection rules before parity is declared.

No other concrete blocking gameplay defect was reproduced.

## Verification performed

- Read all of `packages/game-sim/src/index.ts`, all three `packages/game-sim/test/*` files, `contracts/simulation/README.md`, parsed `golden-v1.json`, read `run-descriptor.schema.json`, `docs/GAME_V1_SPEC.md`, and `docs/GAME_V1_TECH_PLAN.md`.
- `npm test -- --reporter=dot` — **4 files, 65 tests passed**.
- `npm run typecheck && npm run lint && npm run build` — all succeeded; web production bundle built.
- Independent built-core probe replayed the documented seed-3 controller for 24,000 ticks. It observed first pipe contact tick **93**, common safe interval **(222000, 338000)**, every post-contact center within that interval, vertical cycle ticks **115–219** (period **104**), and final state **RUNNING**, tick **24000**, score **261**. This directly supports the documented closed-orbit argument for that controller/default setup. The separate existing tests cover 16 seeds to exactly 24,000 ticks and assert RUNNING.

## Coverage limits / claims not made

- The orbit witness proves one survivable strategy under default physics and the catalog's common gap interval; it does not prove recoverability from arbitrary states or feasibility of custom configs.
- The 9 golden cases and 4 mixer vectors provide useful full-state/event checkpoints, but do not exhaustively enumerate all seeds, custom configurations, and event combinations. The independent stabilization assertions help but are not a universal geometry/property proof.
- No Go implementation/parity run, browser interaction run, real-device memory/performance measurement, or human-vs-bot assessment was performed or inferred from these tests.
