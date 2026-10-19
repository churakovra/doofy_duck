# Working in Doofy Duck

## Start here

Read [README.md](README.md) for current scope and commands, then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to locate code. Use
[docs/README.md](docs/README.md) to select relevant docs; do not load the archive.
Read the nearest component `AGENTS.md` before editing. Distinguish implemented
behavior, dated verification, hosted acceptance and future work.

## Boundaries

- Inspect and preserve existing edits/deletions; never reset unrelated work.
- Physics, generation, scoring and collectible rules belong in the simulation;
  renderer, audio, storage and React consume state/events.
- Simulation changes are a shared TypeScript/Go contract: consult
  [current rules](docs/ARCADE_SIMULATION.md) and
  [fixtures](contracts/simulation/README.md). Never regenerate expected fixtures
  merely to pass a check.
- Keep exact direct dependency pins and the root npm lockfile consistent.
- Treat `dist`, test results and browser reports as generated output.
- Read ignored `local-docs/` only on user request; never copy it into tracked docs.

## Development workflow

1. **Settle the contract:** trace requirements, callers and tests; agree on
   interfaces, transitions, ownership, failure behavior and acceptance criteria
   before assignment. Resolve against approved requirements; ask only for missing
   decisions that need user input.
2. **TDD, red then green:** write meaningful behavior/regression tests, confirm
   the expected failure, then implement the smallest correct change. Assert
   observable requirements. Skipped database tests are not evidence. For behavior
   preservation, use existing/characterization tests; do not manufacture failures.
3. **Refactor and self-review:** simplify names, responsibilities and control flow;
   reuse conventions and add abstractions/dependencies only when needed. Inspect
   the complete diff and failure paths, fix gaps and run affected checks.

Separate required acceptance from optional improvements; identify scope changes.
Separate uncertain feasibility work from implementation. Deliver small, complete
milestones with their affected checks; do not bundle unresolved research with
simulation parity and backend integration. See
[delegation](docs/AGENT_WORKFLOW.md#delegation) for the feasibility gate.
Before expanding controller, simulation or load-test coverage, read
[test assumptions](docs/AGENT_WORKFLOW.md#test-assumptions) and validate the harness.

## Branches and commits

- Create a branch per new feature before implementation; keep related work and
  its workers on that feature boundary. Use `<type>/<short-kebab-case-name>`.
- Commit messages: `<type>: <imperative summary>`; optional scope, e.g.
  `fix(input): Prevent duplicate flaps`. Use `feature` for new functionality;
  otherwise choose fix, refactor, docs, test, chore, build, ci, perf or revert.
- Commit coherent, reviewable milestones, separating distinct concerns. Keep
  related tests/implementation together and leave a coherent project state; do
  not split by edit or arbitrary size.
- Only the chat coordinator changes branches, stages intended files/hunks or commits.
  Preserve unrelated work; serialize overlapping edits and generated outputs.

## Verification

Run from the repo root. Use focused tests and affected type/lint checks during
implementation. After integration, run `npm run check` (types, lint, unit/fixture
and Go tests, build) when application behavior is affected. Standalone workflow
tooling uses focused tooling tests and documentation/link inspection; it does
not require application suites. Add Go race/vet for native behavior and real
database checks for affected persistence paths. Component instructions select
relevant checks.

Repeat full suites only for relevant edits or an unresolved failure; state why.
Evidence belongs to the tested revision: rerun affected checks after edits/conflict
resolution. Report skips/missing environments; never claim unrun or historical
checks as current evidence.

Documentation-only work needs link/diff inspection, not application suites.
Browser suites require explicit request: `npm run check:browser` for both or
`npm run check:full` for routine plus browser checks. Never run them automatically.

## Collaboration

The chat coordinator owns user decisions, Git operations and final integration;
it does not edit application code, tests, scripts or tooling.
A separate feature lead plans each feature, settles its contract and acceptance,
owns file assignments, sequencing, decisions and the canonical status
checkpoint, and delegates implementation and review. Workers ask the lead;
unresolved Medium+ product, UX, public-contract, dependency, scope or acceptance
choices go to the user. Pause work dependent on a pending choice while approved,
independent work may continue. Do not infer user approval or repeat settled
questions. If the decision level is uncertain, escalate to the user; act
autonomously only on reversible implementation details. Workers and reviewers do
not delegate.

| Role or task | Model | Reasoning effort |
| --- | --- | --- |
| Coordinator and feature lead | `gpt-6-luna` | `high` |
| Implementation worker and independent ordinary reviewer | `gpt-6-luna` | `high` |
| Required high-risk review, feasibility analysis or escalated diagnosis | `gpt-6.1-sol` | `medium`, read-only |

Settle observable behavior, interfaces, transitions, ownership, failure behavior
and acceptance before assignment. Parallelize only independent work with settled
ownership; respect actual runtime capacity. Give each worker a concise brief and
each milestone one consolidated review. See [delegation](docs/AGENT_WORKFLOW.md#delegation),
[review](docs/AGENT_WORKFLOW.md#review) and the [workflow templates and reporter](docs/agent-workflow/README.md).
Repository instructions cannot change an active chat's model; select Luna High
manually for coordinator and lead. Explain assignments and do not silently
substitute unavailable models. Never assign Sol code edits. Keep the existing
TDD, reassessment and simulation/backend acceptance safeguards below.

Workers report at completed milestones after checks/self-review, or immediately
for blockers, ownership conflicts or scope changes. The coordinator reviews the
complete milestone without duplicating ongoing implementation investigation.
Independent Sol review is mandatory for simulation/contracts/parity, wallet
persistence/ownership/settlement/deduplication, security, or broad lifecycle/
concurrency changes. Routine work needs the owner, independent Luna reviewer and
coordinator integration review. Documentation-only review by coordinator needs
link and diff inspection.

## Recovery and reporting

After two unsuccessful revisions of the same acceptance failure, stop and read
[reassessment](docs/AGENT_WORKFLOW.md#reassessment). Stop implementation and obtain
an independent diagnosis before another attempt. Record the failing case,
attempts, evidence and materially revised approach with a bounded next check.
Renaming a test/controller or diagnosing a new subproblem does not reset the
unresolved acceptance failure. Ask the user only if the
approach changes approved requirements/scope or needs a missing user decision.

For multi-stage work, use [checkpoints](docs/AGENT_WORKFLOW.md#checkpoints).
Before unattended/long jobs, read [long-running jobs](docs/AGENT_WORKFLOW.md#long-running-jobs).
Bound tool output to summaries/excerpts; retain long logs in files. Avoid polling
unchanged progress; prefer completion notifications or bounded waits. Keep user
updates concise and meaningful. Do not create scheduled follow-ups without consent.

Completion reports state changes, checks actually run/results, and remaining
limitations/blockers. Keep component details in nearest instructions.
