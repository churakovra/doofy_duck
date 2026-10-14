# Working in Doofy Duck

## Start here

Read [README.md](README.md) for current scope and run commands. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to locate the code for your task.
Use [docs/README.md](docs/README.md) to select relevant documentation; do not load
the entire documentation archive by default. Read the nearest component
`AGENTS.md` before editing that component.

This repository implements a local endless pipe game with React/PixiJS, pure
TypeScript simulation, and a matching native Go simulation. The commercial
Telegram service architecture is future direction, not implemented infrastructure.

## Boundaries

- Preserve existing user edits and deletions. Inspect the working tree before
  editing; do not restore unrelated files or reset changes.
- Keep physics, generation, scoring, and collectible rules in the simulation.
  The renderer, audio, storage, and React shell consume state/events.
- Simulation behavior is a shared TypeScript/Go contract. Consult
  [current rules](docs/ARCADE_SIMULATION.md) and the
  [fixture contract](contracts/simulation/README.md) for related changes.
- Never regenerate expected fixtures merely to make a failing check pass.
- Keep exact direct dependency pins and the root npm lockfile consistent.
- Treat `dist`, test results, and browser reports as generated output.
- `local-docs/` is ignored personal context. Read it only when the user requests
  that material; do not copy it into tracked documentation.

## Development workflow

Apply this workflow to every feature or fix, including work delegated to subagents:

1. **Understand the behavior.** Read the requirements and trace the affected code
   path, its callers, and existing tests. Identify the expected behavior, main
   cases, relevant edge cases, and failure conditions before changing code.
2. **Use TDD: red, then green.** Write meaningful tests for that behavior first.
   For a bug, include a regression test that reproduces it. Run the tests and
   confirm they fail for the expected reason, then implement the smallest change
   that makes them pass. Assert observable behavior against requirements rather
   than copying the implementation's logic into the tests.
3. **Refactor after correctness is established.** With passing tests as a safety
   net, improve the code's structure. Keep it simple, readable, and clean: clear
   names, focused responsibilities, and straightforward control flow. Follow the
   surrounding code style and reuse suitable existing code. Add abstractions or
   dependencies only when the current task needs them. Less is more.
4. **Review your own work.** Inspect the final diff against the requirements and
   ask: Does it behave correctly? Do tests cover the main logic and relevant edge
   cases? Is it as clear and simple as practical? Does it fit existing conventions
   and reuse existing code appropriately? Resolve gaps, refactor when needed, and
   rerun the affected checks after changes before reporting completion.

## Branches and commits

Use these project conventions for all new work, including delegated work:

- Create a new branch for every new feature before implementation. Keep that
  feature's related work on its branch; start a separate branch for the next
  feature. Subagents working on the same feature share this feature boundary.
- Branch names: `<type>/<short-kebab-case-name>`, for example
  `feature/local-wallet`, `fix/duplicate-flap`, or `docs/agent-workflow`.
- Commit messages: `<type>: <short imperative summary>`. An optional scope may
  follow the type in parentheses, for example `fix(input): Prevent duplicate flaps`.
- Use `feature` for new functionality, as in `feature: Add local wallet`.
  Other types include `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`,
  `perf`, and `revert`; choose the type that describes the change.
- Split work into commits that each express one coherent, reviewable change.
  Separate distinct concerns instead of collecting a large feature into one
  omnibus commit. Keep related implementation and tests together when that makes
  the change complete and understandable.
- Use meaningful milestones, not individual edits, as commit boundaries. Do not
  create a commit for every small move or formatting adjustment, and do not use
  an arbitrary line count to decide commit size. Each commit should have a clear
  purpose and leave the project in a coherent state.
- Stage only the files or hunks belonging to the intended commit and preserve
  unrelated user work. The main agent coordinates commits for delegated changes.

## Verification

Run commands from the repository root. Choose checks for the affected component
using its instructions. For documentation changes, check links and the diff;
application tests are unnecessary. For a full implementation verification use
`npm run check`, then Go race/vet if native behavior changed. The full check
includes builds and isolated production/development browser suites; it does not
include Go race or vet. Do not claim a check passed unless it ran in this task.
Keep historical verification reports distinguishable from new execution evidence.

## Collaboration

Use subagents proactively when a task has independent parts that benefit from
parallel work, such as exploration, implementation in separate files, or review.
Handle small, tightly coupled tasks directly.

Route delegated work by task. Use the model and reasoning effort in this table
unless the user explicitly requests a different choice:

| Task | Model | Reasoning effort |
| --- | --- | --- |
| Application code for features, fixes, or refactors | `gpt-6-luna` | `high` |
| Writing tests | `gpt-6-luna` | `medium` |
| Writing documentation | `gpt-6-luna` | `medium` |
| Planning | `gpt-6.1-sol` | `high` |
| Review | `gpt-6.1-sol` | `low` normally; `medium` for important or high-risk changes, such as simulation contracts or TypeScript/Go parity, wallet or persistence behavior, security, and broad lifecycle changes |

For mixed-role work, delegate distinct phases with the model and effort suited
to each phase. Pass behavior and acceptance expectations through each handoff;
for example, test-writing work should receive the requirements before
implementation begins. Keep the TDD sequence above: tests precede implementation,
confirm the expected failure, then implement, establish green, refactor, and
review. Delegation does not reduce anyone's self-review obligations.

When spawning with model overrides, use `fork_turns="none"` and include a
self-contained task brief with relevant context, constraints, files, and expected
result. Do not silently substitute another model or effort if the requested one
is unavailable; report the limitation. Respect runtime concurrency limits and
assign distinct file ownership to agents that edit files. The main agent
coordinates the work, reviews returned findings and changes, resolves
integration issues, and reports the final result.
