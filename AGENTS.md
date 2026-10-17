# Working in Doofy Duck

## Start here

Read [README.md](README.md) for current scope and run commands. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to locate the code for your task.
Use [docs/README.md](docs/README.md) to select relevant documentation; do not load
the entire documentation archive by default. Read the nearest component
`AGENTS.md` before editing that component.

The repository contains local practice, shared TypeScript/Go simulation, and an
optional account/run backend. Use the current README and dated verification
records to distinguish implemented behavior from hosted acceptance and future work.

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

Apply this workflow to every feature or fix, including delegated work:

1. **Settle the contract.** Trace requirements, callers and tests. Before assigning
   implementation, agree on shared interfaces, state transitions, ownership,
   failure behavior and acceptance criteria. Resolve ambiguity against approved
   requirements; identify decisions that actually need user input.
2. **Use TDD: red, then green.** Write meaningful behavior/regression tests first,
   run them and confirm the expected failure, then implement the smallest correct
   change. Assert observable requirements rather than copying implementation logic.
   A skipped database test is not red or green evidence. For behavior-preserving
   work, use existing tests or characterization tests; do not manufacture a failure.
3. **Refactor and self-review.** With passing tests, simplify names, responsibilities
   and control flow. Reuse surrounding conventions and add abstractions/dependencies
   only when needed. Inspect the complete diff and relevant failure paths; fix gaps
   and run affected checks before handing the milestone back.

Keep required acceptance work separate from optional improvements. Identify any
necessary scope change explicitly instead of expanding work during verification.

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

Run commands from the repository root; component instructions select relevant checks.
Use focused tests and affected type/lint checks during implementation. Run
`npm run check` after integration for final routine verification: types, lint,
unit/fixture tests, Go tests and build. Run Go race/vet for native behavior changes
and real database checks for affected persistence paths.

Repeat a full suite only after relevant changes or a specific unresolved failure;
state the reason. Evidence applies to the tested revision: after edits or conflict
resolution, rerun affected checks. Report skipped checks and missing environments
explicitly; never claim execution that did not happen or reuse historical results
as current evidence.

Documentation-only work needs link/diff inspection, not application tests.
Playwright/browser suites run only when explicitly requested: use
`npm run check:browser` for both suites or `npm run check:full` for routine plus
browser checks. Do not run or repeat browser suites automatically.

## Collaboration

### Responsibilities

The main agent owns requirements, shared decisions, assignment, integration review
and reporting. It does not change application code, tests, scripts or build/tooling
configuration; documentation-only changes may be handled directly.

One implementation worker owns each coherent feature through understanding, TDD,
implementation, focused checks and self-review. Keep that owner through revisions;
do not split ordinary test writing and implementation between agents.

Keep main-agent coordination short. Review the returned milestone and its boundaries
without duplicating the worker's implementation investigation or narrating routine work.

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

Use one implementation worker by default. Add another only for independent
components with settled interfaces, separate file ownership and a clear benefit.
Only the main agent delegates; workers must not spawn agents. Respect concurrency
limits and do not fill slots merely because they are available.

Worker briefs contain behavior/acceptance criteria, owned files, required checks
and relevant instruction/document paths. Reference shared instructions instead of
copying them into every brief. Workers read only needed context and follow the root
and nearest component instructions. Use `fork_turns="none"` with model overrides.

Workers complete implementation, focused checks and self-review before requesting
integration review. Return concise findings; include detailed logs only for diagnosis.

### Ownership and integration

Inspect and preserve existing user changes before assigning work.

Assign one owner to each edited file. Workers must request reassignment before
editing outside their scope.

In a shared checkout, only the main agent changes branches, stages files, or
creates commits. Workers must not reset, restore, or overwrite another person's
or agent's changes.

Serialize work that overlaps in files or writes shared generated artifacts.
Use isolated worktrees when isolation materially helps; do not create one
automatically for every worker.

### Review and verification

The main agent reviews the complete returned milestone against acceptance criteria.
Require one batched independent review for milestones involving:

- Simulation behavior, shared contracts, or TypeScript/Go parity.
- Wallet persistence, ownership, settlement, or deduplication.
- Security-sensitive changes.
- Broad lifecycle or concurrency changes.

Reviewers receive requirements and the complete diff, and independently inspect
callers, tests and failure paths. Consolidate findings into one revision request to
the existing Luna owner. Recheck changed paths and affected callers; reopen broader
review only when scope or evidence warrants it. Routine changes need worker and
main-agent review, without an additional reviewer.

Before sustained load tests, complete requirement-coverage review, resolve blocking
findings, pass integration checks and freeze the tested backend revision. Record
local, browser, real Telegram and hosted acceptance separately. Apply the
Verification section after integration and subsequent relevant changes.

### Long-running jobs

Launch unattended jobs with a bounded duration, saved logs and a final summary.
Record the tested revision, job/container identity, log location and exact result
collection command. Do not use repeated AI turns to poll unchanged progress or
parse routine logs that a local command can summarize.

For jobs expected to take more than a few minutes, the user authorizes returning
control after launch with a clear resume checkpoint. Collect results on the user's
return or through an available completion notification. Do not create scheduled
follow-ups without user authorization. Report a running job as running, not passed.

### Recovery and reporting

After two unsuccessful revision cycles on the same issue, stop the retry loop and
reassess the contract, design or missing evidence before another implementation
attempt. A worker discovering a larger problem reports it promptly. The main agent
adjusts the task or provides targeted analysis instead of continuing the same approach.

Before replacing a worker, preserve a concise handoff with changed files,
decisions, remaining work, and check results.

Each completion report states what changed, checks actually run and their outcomes,
and remaining limitations/blockers. Keep component-specific details in the nearest
component instructions and avoid duplicating this workflow there.
