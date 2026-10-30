# Doofy Duck

Doofy Duck is a development foundation for an account-backed Telegram Mini App game. React/PixiJS presents a shared TypeScript simulation, TypeScript Core verifies runs, and Python/PostgreSQL provide identity, account and economy services. The Go Core is retained for compatibility and comparison. Read [README.md](README.md) for current scope and startup commands.

## Repository map

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): runtime flow, source ownership and code locations.
- [docs/README.md](docs/README.md): documentation index and topic map.
- [docs/PRODUCT_VISION.md](docs/PRODUCT_VISION.md): intended audience, product scope and open decisions.
- [docs/ARCADE_SIMULATION.md](docs/ARCADE_SIMULATION.md) and [contracts/simulation/README.md](contracts/simulation/README.md): shared rules and fixtures.
- `apps/web`: browser game and interface; `packages/game-sim`: TypeScript rules.
- `services/core`: TypeScript verification and retained Go comparison; `services/platform`: Python identity and economy.
- `deploy`: local service stack and smoke tooling.

Read the nearest component `AGENTS.md` and the current topic documentation for details. Keep product intent distinct from implemented behavior.

## Instruction scope

Follow system, developer, and user instructions before repository guidance.
Use component instructions for local context. Check the code and contracts for current behavior.
