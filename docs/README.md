# Documentation map

Start with the [root README](../README.md) for setup and current capabilities,
[Product vision](PRODUCT_VISION.md) for approved product intent, and
[ARCHITECTURE](ARCHITECTURE.md) for code ownership. Read only what the task needs.

Follow the [development workflow](../AGENTS.md#development-workflow) and
[branch/commit conventions](../AGENTS.md#branches-and-commits). For delegation,
review, test assumptions, recovery, checkpoints or long jobs, read the relevant
section of the [agent workflow reference](AGENT_WORKFLOW.md); it is not required
reading in full for every task.

Per-feature collaboration-state templates and the selected-run telemetry tool
are documented in [agent-workflow templates](agent-workflow/README.md). The
`.agent-workflow/` runtime records are local and ignored by Git.

## Product and current implementation

| Document | Use it for |
| --- | --- |
| [Product vision](PRODUCT_VISION.md) | Purpose, audience, commercial release scope, economy boundaries, and open decisions |
| [Foundation](FOUNDATION.md) | Extension boundaries for rule configuration, cosmetics, events, and future statistics |
| [Development plan](DEVELOPMENT_PLAN.md) | MVP finish line, prioritized feature backlog, next batch, dependencies, and release acceptance gates |
| [MVP specifications](MVP_SPECIFICATIONS.md) | Proposed difficulty, run/continue/settlement and economy rules, acceptance scenarios, and owned product/release/infrastructure decision gates |
| [Unified account game](UNIFIED_ACCOUNT_GAME.md) | Single account-backed entry, complete local startup and October 18 verification |
| [SHOP implementation record](SHOP_IMPLEMENTATION_RESULTS.md) | Delivered code, default-off activation and current verification limits |
| [SHOP implementation backlog](SHOP_IMPLEMENTATION_PLAN.md) | Item 6 tasks, WALLET prerequisites, decision gates and verification sequence |
| [Backend foundation](BACKEND_FOUNDATION.md) | Approved ACCOUNT/RUN scope, implementation evidence and outstanding hosted acceptance |
| [Backend operations](BACKEND_OPERATIONS.md) | Hosted acceptance, outage response, durable delivery, restore and rollback runbook |
| [Challenge verification](CHALLENGE_RESULTS.md) | Feature 1 implementation, executed checks dated 2026-10-17, bounded physics/replay evidence and open playtest/device acceptance |
| [Wetland challenges](WETLAND_CHALLENGES.md) | Varied static obstacles, authored reward routes, ruleset compatibility and current verification status |
| [Arcade simulation](ARCADE_SIMULATION.md) | Current mechanics, identities, bounds, and parity limits |
| [Simulation contract](../contracts/simulation/README.md) | Shared fixtures and deliberate regeneration workflow |
| [Local wallet](WALLET_UPDATE.md) | Record validation, settlement, tab ownership, and storage fallback |
| [Telegram bot setup](TELEGRAM_BOT_SETUP.md) | Launch-bound automatic identity, BotFather setup and local real-Telegram test configuration |
| [Audio implementation](AUDIO_IMPLEMENTATION.md) | Controller API, integration, and playback lifecycle |
| [Flight feel](FLIGHT_FEEL.md) | Cosmetic motion, bounded effects, and reduced motion |
| [Cosmetic authoring](COSMETICS.md) | Local wardrobe flow, stable catalog IDs, replaceable art, image conventions and fallback |
| [Renderer lifecycle](RENDERER_LIFECYCLE.md) | Serialized Pixi initialization/destruction and checks |
| [Native simulation benchmarks](SIMULATION_BENCHMARKS.md) | Reproducible workload, allocations, and measured local baseline |
| [Earlier arcade integration verification](ARCADE_FIXES_RESULTS.md) | Historical integration checks dated 2026-10-14 |

Product vision describes the target, not implemented capabilities. Simulation
rules and component notes describe current behavior. Recorded checks retain their
execution date and are not a live health indicator. Physical Telegram/mobile
behavior, named-device performance, and owner gameplay assessment remain open.

## Service architecture and supporting research

| Document | Use it for |
| --- | --- |
| [ADR-001](ADR-001-MICROSERVICES.md) | Approved Python/Go service ownership and consistency boundaries |
| [ADR-002](ADR-002-CLIENT-AND-REWARDS.md) | HTTP verification direction, currency boundaries, and later gift workflow |
| [ADR-003](ADR-003-CURRENCY-AND-BROKER.md) | Current currency names, approved HTTP delivery and deferred RabbitMQ |
| [Telegram audio research](TELEGRAM_AUDIO_RESEARCH.md) | Browser-policy basis and real-device validation limits |

Supporting source ledgers: [microservices](microservices-sources.json),
[client](client-research-sources.json), [broker](broker-research-sources.json), and
[audio](audio-research-sources.json). These record dated source observations;
verify provider documentation again when implementation depends on it.

Future architecture does not imply deployed services. Detailed prices, economics,
continue behavior, and gift policies remain unresolved as listed in the vision.
Remove obsolete documents and outdated sections rather than retaining competing
requirements; keep links and this map consistent with the remaining files.
