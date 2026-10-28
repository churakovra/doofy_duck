# Documentation map

Start with the [root README](../README.md) for setup and current capabilities.
The [product vision](PRODUCT_VISION.md) describes the intended product.
The [code map](ARCHITECTURE.md) identifies source ownership.

| Document | Use it for |
| --- | --- |
| [Arcade simulation](ARCADE_SIMULATION.md) | Rules, compatibility and parity limits |
| [Simulation contract](../contracts/simulation/README.md) | Fixtures and deliberate regeneration |
| [Foundation](FOUNDATION.md) | Extension boundaries |
| [Wallet and progress](WALLET_UPDATE.md) | Settlement and account balances |
| [Cosmetic authoring](COSMETICS.md) | Catalog and appearance mappings |
| [Backend operations](BACKEND_OPERATIONS.md) | Service operation, recovery and acceptance |
| [Telegram bot setup](TELEGRAM_BOT_SETUP.md) | Launch identity and local bot configuration |
| [Audio implementation](AUDIO_IMPLEMENTATION.md) | Audio API and playback lifecycle |
| [Flight feel](FLIGHT_FEEL.md) | Cosmetic motion and reduced motion |
| [Renderer lifecycle](RENDERER_LIFECYCLE.md) | Pixi initialization and cleanup |
| [Verification assumptions](VERIFICATION.md) | Simulation and controller evidence limits |
| [Workflow telemetry](agent-workflow/README.md) | Optional local session report |

HTTP contracts describe [account authentication](../contracts/http/account-auth-v1.md),
[runs](../contracts/http/core-run-v1.md), [wallets](../contracts/http/economy-wallet-v1.md)
and [the shop](../contracts/http/economy-shop-v1.md).
