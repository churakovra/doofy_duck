# Agent workflow reference

[Root instructions](../AGENTS.md) contain everyday requirements. Read only the
section triggered by your task; do not load this whole reference by default.
Component instructions still apply. This reference defines workflow, not product
requirements or evidence that any implementation has passed acceptance.

## Delegation

Read before assigning implementation or delegated documentation.

- Inspect existing changes before assignment. Brief the worker on behavior and
  acceptance criteria, owned files, required checks and relevant instruction/doc
  paths. Reference shared instructions instead of copying them. Workers read only
  needed context and follow root and nearest component instructions.
- Use the root model routing and `fork_turns="none"` with model overrides. Only
  the main agent delegates; workers must not spawn agents. Respect concurrency
  limits and do not fill slots merely because they exist.
- Keep one implementation owner through understanding, TDD, implementation,
  focused checks, self-review and revisions. Add a second worker only for
  independent components with settled interfaces, separate ownership and a clear
  benefit. Do not split ordinary test writing from implementation.
- Assign one owner per edited file. Workers request reassignment before editing
  outside scope; they must not change branches, stage, commit, reset, restore or
  overwrite another person's or agent's work. Main coordinates Git operations.
- Serialize overlapping files and shared generated artifacts. Use isolated
  worktrees when isolation materially helps, not automatically for every worker.
- Request reports at completed milestones, not after each edit. Reports include
  changed behavior, checks/results and open acceptance gaps. Report blockers,
  ownership conflicts, scope changes and larger discoveries immediately.
- During implementation, main resolves shared decisions and blockers without
  repeating the worker's investigation. Review the complete returned milestone;
  short coordination does not replace integration review.

## Test assumptions

Read before expanding controller, simulation or load-test coverage.

Establish representative cases that validate the harness before scaling seeds,
transitions or runtime. For a flight controller, establish screen-edge visibility,
observation/reaction timing, requested speed, entry position/velocity, complete
pickup criteria and survival through the following exit. For other harnesses,
check the applicable inputs, timing, workload and success conditions; mark any
inapplicable assumptions explicitly.

Separate the requirement from the controller strategy and fixture assumptions.
A failed controller trace does not itself prove impossible geometry. Diagnose
which assumption, strategy or product behavior failed and retain a reproducible
case. Do not weaken approved delay, visibility, speed, coverage or exit criteria
to get a pass. Harness corrections invalidate dependent results; rerun affected
cases and label earlier evidence superseded.

Keep required acceptance separate from optional coverage. Bounded witnesses are
bounded evidence, not universal reachability or proof of human playability.

## Review

Read before integration review; also before sustained load testing.

Main reviews the complete milestone against acceptance criteria. Require one
batched independent review for simulation behavior, shared contracts or TS/Go
parity; wallet persistence, ownership, settlement or deduplication; security; and
broad lifecycle/concurrency changes. Routine changes need worker and main review,
without an additional reviewer. Documentation handled directly by main needs
link/diff inspection.

Give the reviewer requirements and the complete diff. Reviewers independently
inspect callers, tests and failure paths. Consolidate findings into one revision
request to the existing Luna owner. Recheck changed paths and affected callers;
reopen broad review only when scope or evidence warrants it. Apply the root
verification requirements after integration and subsequent relevant edits.

Before sustained load tests, complete requirement-coverage review, resolve blocking
findings, pass integration checks and freeze the tested backend revision. Record
local, browser, real Telegram and hosted acceptance separately. Do not substitute
one category for another.

## Reassessment

Read after two unsuccessful revision cycles on the same acceptance failure, before
another attempt. A cycle is a proposed fix followed by verification that still
fails the requirement, including a claimed pass later invalidated by review.
Renaming a test/controller or splitting the same failure does not reset the count.

Stop the repair loop and update the checkpoint with:

- The requirement and reproducible failing case.
- Both attempted fixes and exact checks/results, including invalidated evidence.
- Likely cause and remaining uncertainty: contract, harness, controller, design
  or missing environment/evidence.
- A revised approach and the smallest next check that can distinguish causes.

Main reassesses the contract/design and provides targeted analysis or narrows the
work, then returns implementation to the existing owner. Do not repeat the same
approach without new evidence. Ask the user only for changes to approved scope or
requirements, or a missing decision that needs their input. Reassessment does not
waive acceptance requirements or authorize model substitution.

## Checkpoints

Read when starting multi-stage work, preparing reassessment, or handing off.

Maintain one task-specific Markdown checkpoint in the system temporary directory;
record its absolute path in the chat. Keep one current document rather than an
append-only transcript. Include:

- Task objective, worktree, branch and base revision; identify uncommitted edits
  and ownership so a clean HEAD is never mistaken for the complete tested state.
- Settled interfaces/decisions, approved acceptance requirements and open gaps.
- Failed attempts and current reassessment count for each unresolved failure.
- Exact check commands, outcomes and tested revision/state; distinguish skipped,
  running, failed, passed and superseded evidence.
- Active worker IDs and responsibilities, relevant log/job references, and the
  next concrete action.

Refresh at milestones, reassessment and handoff. Before replacing a worker, include
changed files, decisions, remaining work and check results. Keep credentials and
private material out of checkpoints. Temporary files may be cleaned up: if lost,
reconstruct state from Git, owners and logs before acting; never infer a pass.

When context becomes burdensome and the objective is unchanged, refresh the
checkpoint and use supported compaction if available. When the objective changes,
start a fresh chat with the checkpoint and relevant requirements; do not carry
unrelated history by default. Respect product controls and user authorization
for creating chats. Existing chats may need an explicit instruction refresh;
editing repository instructions does not guarantee they were reloaded.

Do not promise automatic compaction, a fixed token threshold or savings. Evaluate
actual context/token use on a subsequent comparable task; a smaller instruction
file alone is not a performance measurement.

## Long-running jobs

Read before launching unattended jobs or jobs expected to take more than a few
minutes. Launch with a bounded duration, saved logs and a final summary. Record
the tested revision and dirty state, job/container identity, log location and exact
result collection command in the checkpoint.

Bound tool responses to summaries and relevant excerpts; retain full logs in
files. Use local commands to summarize routine output rather than repeated AI
turns. Avoid polling unchanged progress; use completion notifications or bounded
waits when available. Keep user updates concise and meaningful; a waiting agent
must not become a repeated status parser.

For jobs expected to take more than a few minutes, the user authorizes returning
control after launch with a clear resume checkpoint. Collect results on their
return or via an available completion notification. Do not schedule follow-ups
without user authorization. Report running jobs as running, never passed. Report
changes, checks actually run/results and remaining limitations at completion.
