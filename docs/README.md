# Documentation map

Start with the [root README](../README.md) for setup and current capabilities,
[Product vision](PRODUCT_VISION.md) for approved product intent, and
[ARCHITECTURE](ARCHITECTURE.md) for code ownership. Read only what the task needs.

Follow the [development workflow](../AGENTS.md#development-workflow) and
[branch/commit conventions](../AGENTS.md#branches-and-commits).

## Product and current implementation

| Document | Use it for |
| --- | --- |
| [Product vision](PRODUCT_VISION.md) | Purpose, audience, commercial release scope, economy boundaries, and open decisions |
| [Foundation](FOUNDATION.md) | Extension boundaries for rule configuration, cosmetics, events, and future statistics |
| [Arcade simulation](ARCADE_SIMULATION.md) | Current mechanics, identities, bounds, and parity limits |
| [Simulation contract](../contracts/simulation/README.md) | Shared fixtures and deliberate regeneration workflow |
| [Local wallet](WALLET_UPDATE.md) | Record validation, settlement, tab ownership, and storage fallback |
| [Audio implementation](AUDIO_IMPLEMENTATION.md) | Controller API, integration, and playback lifecycle |
| [Flight feel](FLIGHT_FEEL.md) | Cosmetic motion, bounded effects, and reduced motion |
| [Renderer lifecycle](RENDERER_LIFECYCLE.md) | Serialized Pixi initialization/destruction and checks |
| [Native simulation benchmarks](SIMULATION_BENCHMARKS.md) | Reproducible workload, allocations, and measured local baseline |
| [Latest recorded verification](ARCADE_FIXES_RESULTS.md) | Executed integration checks dated 2026-10-14 |

Product vision describes the target, not implemented capabilities. Simulation
rules and component notes describe current behavior. Recorded checks retain their
execution date and are not a live health indicator. Physical Telegram/mobile
behavior, named-device performance, and owner gameplay assessment remain open.

## Future architecture and supporting research

| Document | Use it for |
| --- | --- |
| [ADR-001](ADR-001-MICROSERVICES.md) | Selected future Python/Go service ownership and consistency boundaries |
| [ADR-002](ADR-002-CLIENT-AND-REWARDS.md) | HTTP verification direction, currency boundaries, and later gift workflow |
| [ADR-003](ADR-003-CURRENCY-AND-BROKER.md) | Current currency names and pending RabbitMQ recommendation |
| [Telegram audio research](TELEGRAM_AUDIO_RESEARCH.md) | Browser-policy basis and real-device validation limits |

Supporting source ledgers: [microservices](microservices-sources.json),
[client](client-research-sources.json), [broker](broker-research-sources.json), and
[audio](audio-research-sources.json). These record dated source observations;
verify provider documentation again when implementation depends on it.

Future architecture does not imply deployed services. Detailed prices, economics,
continue behavior, and gift policies remain unresolved as listed in the vision.
Remove obsolete documents and outdated sections rather than retaining competing
requirements; keep links and this map consistent with the remaining files.
