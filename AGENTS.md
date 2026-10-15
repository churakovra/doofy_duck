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
application tests are unnecessary. During a fix, run focused unit tests and the
affected type/lint checks. Use `npm run check` for final routine verification:
types, lint, unit/fixture tests, Go tests, and build. Run Go race/vet if native
behavior changed. Playwright/browser tests are on demand only: do not run them
after routine fixes or automatically repeat them to obtain a passing run. When
the user explicitly requests browser verification, use `npm run check:browser`
for both browser suites or `npm run check:full` for routine plus browser checks.
Do not claim a check passed unless it ran in this task.
Keep historical verification reports distinguishable from new execution evidence.

## Collaboration

### Responsibilities

The main agent owns requirements, acceptance criteria, shared design decisions,
task assignment, integration review, and the final report. It does not write or
change application code, tests, scripts, or build/tooling configuration.
Documentation-only changes may be handled directly.

Delegate each coherent code change to one implementation worker. That worker
owns the complete development cycle: understand the behavior, write meaningful
tests, confirm the expected failure, implement the change, run focused checks,
refactor when useful, and self-review.

Do not create separate test-writing and implementation agents for ordinary work.
Send revisions back to the existing worker while its context remains useful.

For behavior-preserving refactors, use existing tests or add characterization
tests before editing. Do not manufacture a failing test when behavior should
remain unchanged.

### Model routing

Use these defaults:

| Task | Model | Reasoning effort |
| --- | --- | --- |
| Code, tests, and implementation fixes | `gpt-6-luna` | `high` |
| Delegated documentation | `gpt-6-luna` | `medium` |
| Planning and coordination | Main agent | Current setting |
| Routine review | Main agent | Current setting |
| Independent review | `gpt-6.1-sol` | `low`; `medium` for high-risk changes |

Do not delegate code writing to Sol. If Luna cannot complete a task, the main
agent should clarify the requirements, narrow the task, or provide targeted
analysis, then return implementation to Luna.

If a required model is unavailable, report the limitation. Do not silently
substitute another model.

### Delegation and concurrency

Use one implementation worker by default. Add another worker only when tasks
are independent and the benefit justifies additional context and coordination.

Do not spawn agents merely to fill available concurrency slots. Only the main
agent delegates work; workers must not spawn further agents.

Give each worker a concise, self-contained brief containing:

- Required behavior, acceptance criteria, and relevant edge cases.
- Owned files or component boundaries.
- Applicable root and component instructions and relevant documentation.
- Required checks and the expected completion report.

Require workers to read and follow the applicable instructions and development
workflow. When spawning with model overrides, use `fork_turns="none"`.
Respect runtime concurrency limits.

Workers should read only the context needed for their task. Return concise
findings and check summaries; include detailed logs only when needed to
diagnose a failure.

### Ownership and integration

Inspect and preserve existing user changes before assigning work.

Agree on shared interfaces and behavior before parallel implementation.
Assign one owner to each edited file. Workers must request reassignment before
editing outside their scope.

In a shared checkout, only the main agent changes branches, stages files, or
creates commits. Workers must not reset, restore, or overwrite another person's
or agent's changes.

Serialize work that overlaps in files or writes shared generated artifacts.
Use isolated worktrees when isolation materially helps; do not create one
automatically for every worker.

### Review and verification

Every worker self-reviews its diff and runs the relevant focused checks.

The main agent inspects the returned diff against acceptance criteria and
coordinates final routine verification with `npm run check`. Avoid repeating
checks on an unchanged state without a specific reason. Documentation-only
changes follow the Verification section and do not require application checks.

Require one independent review for:

- Simulation behavior, shared contracts, or TypeScript/Go parity.
- Wallet persistence, ownership, settlement, or deduplication.
- Security-sensitive changes.
- Broad lifecycle or concurrency changes.

Routine changes use worker self-review and main-agent review without an
additional review agent.

Reviewers receive the requirements and diff and independently inspect relevant
callers, tests, and failure paths. Implementation revisions return to Luna.

Verification evidence applies to the state tested. After relevant edits,
conflict resolution, or integration changes, rerun affected checks.
Browser verification remains governed by the Verification section.

### Recovery and reporting

If a worker repeats an unsuccessful approach or discovers a larger problem,
it must report the evidence and blocker. The main agent then adjusts the task
or provides targeted analysis; do not continue an unproductive retry loop.

Before replacing a worker, preserve a concise handoff with changed files,
decisions, remaining work, and check results.

Each completion report states:

- What changed.
- Which checks ran and their results.
- Remaining limitations or blockers.

Never claim verification that did not run.
