# Documentation map

Start with the root [README](../README.md) for what runs today and
[ARCHITECTURE](ARCHITECTURE.md) for code ownership and change routing. Read only
the documents relevant to the task. Historical reports retain their original
findings and commands; their present-tense statements describe their checkpoint.

For feature and fix work, follow the [development workflow](../AGENTS.md#development-workflow):
understand the behavior, use TDD, make it work, refactor for simplicity, and review
the final result against the requirements. This also applies to subagents.

Follow the [branch and commit conventions](../AGENTS.md#branches-and-commits):
branches such as `feature/local-wallet` and commits such as
`feature: Add local wallet`.

## Current implementation

| Document | Use it for |
| --- | --- |
| [Arcade simulation](ARCADE_SIMULATION.md) | Current mechanics, identities, integer bounds, and parity limits |
| [Simulation contract](../contracts/simulation/README.md) | Shared fixtures, schema, and deliberate regeneration workflow |
| [Arcade tuning notes](ARCADE_TUNING_NOTES.md) | Recorded rationale for flight, random gaps, speed, and pickups; pending status superseded by current rules/results |
| [Wallet update](WALLET_UPDATE.md) | Local wallet schema, exclusive tab ownership, and storage fallback |
| [Audio implementation](AUDIO_IMPLEMENTATION.md) | Audio interface and browser lifecycle |
| [Flight feel](FLIGHT_FEEL.md) | Cosmetic motion, bounded effects, and reduced motion |
| [Renderer lifecycle](RENDERER_LIFECYCLE.md) | Serialized Pixi initialization/destruction and its regressions |
| [Arcade fixes results](ARCADE_FIXES_RESULTS.md) | Latest recorded integration checks, dated 2026-10-14 |

Recorded checks are evidence of a past execution, not a live health indicator.
Physical Telegram/mobile behavior, named-device performance, and owner gameplay
assessment remain open acceptance work according to the latest integration report.

## Requirements and authority

| Document | Role |
| --- | --- |
| [Game V1 specification](GAME_V1_SPEC.md) | Baseline gameplay scope and acceptance goals |
| [V1 technical plan](GAME_V1_TECH_PLAN.md) | Baseline implementation requirements and milestones |
| [V1 QA checklist](V1_QA_CHECKLIST.md) | Proposed acceptance probes, not a completion checklist |
| [Playtest update](PLAYTEST_UPDATE.md) | Later scope amendment adding cumulative wallet, audio, and speed ramp |

The baseline specification and plan predate the implemented wallet/audio/speed
updates. Those scope additions remain relevant, while the playtest document's old
simulation mechanics and identities have been replaced by **Arcade simulation**.
For an implementation task, use the current README, current rules, and relevant
component notes together. If a new task conflicts with the recorded requirements,
state the conflict rather than silently treating old plans as current behavior.
Source and fixtures describe implemented behavior; they do not by themselves
approve changing a requirement or prove release acceptance.

## Future product architecture and research

These documents explain decisions and proposed commercial services. They do not
require adding services to the local gameplay foundation.

| Document | Role |
| --- | --- |
| [ADR-001](ADR-001-MICROSERVICES.md) | Selected Python/Go service boundaries; revised by later ADRs |
| [ADR-002](ADR-002-CLIENT-AND-REWARDS.md) | Browser client, HTTP checkpoint direction, and gift restrictions |
| [ADR-003](ADR-003-CURRENCY-AND-BROKER.md) | Currency names and proposed broker choice |
| [Initial design](INITIAL_DESIGN.md) | Historical feasibility proposal; backend direction superseded |
| [Telegram audio research](TELEGRAM_AUDIO_RESEARCH.md) | Dated browser/Telegram source findings and implementation inferences |

Research ledgers: [initial](research-sources.json),
[microservices](microservices-sources.json), [client](client-research-sources.json),
[broker](broker-research-sources.json), and [audio](audio-research-sources.json).
Provider claims are dated research; verify current primary sources when a new
task depends on them.

## Historical implementation and review checkpoints

| Area | Reports in reading order |
| --- | --- |
| Initial implementation instructions | [Agent brief](AGENT_IMPLEMENTATION_BRIEF.md), retained for history only |
| TypeScript foundation | [Core implementation](CORE_IMPLEMENTATION.md) → [Parent stabilization](PARENT_CORE_VERIFICATION.md) → [Core review](CORE_REVIEW.md) |
| Go foundation | [Go implementation](GO_IMPLEMENTATION.md) → [Initial review](GO_REVIEW.md) → [Review follow-up](GO_REVIEW_FOLLOWUP.md) |
| Web foundation | [Web implementation](WEB_IMPLEMENTATION.md) → [Initial review](WEB_REVIEW.md) → [Final review](FINAL_WEB_REVIEW.md) |
| Foundation integration | [Integration verification](INTEGRATION_VERIFICATION.md) → [Implementation handoff](IMPLEMENTATION_HANDOFF.md) |
| Later playtest iteration | [Playtest results](PLAYTEST_UPDATE_RESULTS.md), [Speed update](SPEED_UPDATE.md) |

These reports predate all or part of the current arcade rules. A failed initial
review and its successful scoped follow-up are both preserved; neither establishes
the status of unrelated paths or later changes. Follow the current implementation
table above for today's mechanics.

Historical screenshots: [ready](web-ready.png), [running](web-running.png),
[development verification](web-dev-verified.png), and
[wallet/death](web-wallet-death.png). They are snapshots, not approved final art.
