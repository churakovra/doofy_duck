# Agent implementation brief — Doofy Duck v1 foundation

> Historical initial implementation brief. Its repository inventory and workflow
> describe the pre-implementation checkpoint. Use [root AGENTS.md](../AGENTS.md)
> for current instructions and the [documentation map](README.md) for task context.

## Authority and scope

The owner requested implementing the plan with agents. Read `docs/GAME_V1_SPEC.md` and `docs/GAME_V1_TECH_PLAN.md` in full before changes; they supersede the broad product research for this milestone. This is a simple endless pipe game: tap flight, collision/death, one point per passed pair, occasional Feather/GameStar subclasses, pause/restart, personal best, deterministic rules. No shop, real currencies/rewards, boosters, social features, backend HTTP, broker, database, full Python service scaffold, final art, or production release.

Root: `/Users/churakovra/dev/doofy_duck`. Current inventory is documentation and two empty legacy directories (`doofy_facade`, `doofy_core`). Preserve them and all existing research. There is no Git repository. Do not create remote repositories, push, deploy, stage/commit, tag a release, or delete unrelated files. No bot tokens, credentials, populated environment files, payments, public tunnel, or live Telegram operations are needed for this phase.

Observed local tools: Node v26.7.0, npm 11.19.0, Go go1.27.2, Python 3.9.6. These are installed observations, not a recommendation that they are the correct production versions. Verify actual package engine compatibility and registry metadata when choosing dependencies; pin exact direct versions and commit-style lockfiles to disk, without changing the machine-wide toolchain. Do not silently install an alternate global runtime or global package. If package retrieval fails, report it and try a bounded reasonable alternative; never fabricate package/API/test output.

## Work ownership and phases

Phase A:
- Core implementation agent owns `packages/game-sim/**`, `contracts/simulation/**`, minimal root package/workspace/config/lock files needed to run it, and `docs/CORE_IMPLEMENTATION.md` including command evidence. Do not create frontend or Go implementations. Establish and document the complete public API, numeric/PRNG rules, serializable state, and fixtures before handing off to consumers. Keep it minimal, not a generic engine.
- Requirements/QA agent owns only `docs/V1_QA_CHECKLIST.md`; all other access is read-only. Review scope, identify concrete edge cases and measurable acceptance checks. A requirements audit is not final independent code review; do not report in-progress implementation as complete or wait for it.

Phase B (parent dispatches after Phase A contract verification): frontend agent owns `apps/web/**`; Go parity agent owns `services/core/**`. Shared contract changes require coordination through the parent. A separate review checks code and executed tests before integration completion.

Agents share the same workspace; do not modify another agent's paths. Do not delegate further. Never poll/wait for another agent; finish the independent assigned slice and return an honest handoff.

## Mandatory implementation discipline

Load the relevant available skills, especially test-driven-development for production code. Use vertical RED → GREEN → REFACTOR cycles: a behavior assertion fails for the expected missing behavior, then minimal implementation, then focused and regression tests. Missing imports/dependencies are not acceptable behavioral RED proof. Record concise real commands/results and important failure evidence. Do not weaken tests, suppress diagnostics, or regenerate fixtures blindly to get green. Scaffolding configuration is not production gameplay logic.

All random/gameplay state is explicit; no DOM, React, PixiJS, wall clock, storage, or network in pure simulation. Gameplay values use bounded integer/fixed-point units with exact order/rounding/overflow rules. Use fixed ticks, once-only events, terminal death, immutable run configuration and reproducible input/state/events. Renderer-only randomness must not alter gameplay. Keep live entities and inputs bounded; test pattern boundaries and rebasing. Currency events are local practice facts, not account credits or Telegram Stars.

## Required handoff

Return: changed paths; exported API/contract and defaults; dependencies and versions actually used; exact executed checks and outcomes; RED/GREEN evidence location; requirement IDs covered; known gaps/limitations and next dependent steps. Distinguish passing tests from unexecuted targets and hypothesis from proof. Do not claim the whole v1 complete, real-device testing, zero memory leaks, universal generator safety, or production readiness based on unit tests alone. Parent will rerun checks and inspect artifacts before accepting claims.
