# Agent workflow reference

[Root instructions](../AGENTS.md) contain everyday requirements. Read only the
section triggered by your task; do not load this whole reference by default.
Component instructions still apply. This reference defines workflow, not product
requirements or evidence that any implementation has passed acceptance.

## Delegation

Read before assigning implementation or delegated documentation.

- Inspect existing changes before assignment. Brief the worker on behavior and
  acceptance criteria for one coherent milestone, owned files, required checks,
  a reporting/stop bound and relevant instruction/doc paths. Reference shared
  instructions instead of copying them or the investigation history.
- The chat coordinator owns user communication and final reporting. A separate
  feature lead owns whole-feature planning, settled interfaces and acceptance,
  dependencies, file ownership, decisions and the current checkpoint. Only the
  coordinator and lead delegate. The lead may dispatch implementation workers
  and reviewers; workers and reviewers do not delegate.
- Settle observable behavior, interfaces, transitions, ownership, failure
  behavior and acceptance before assignment. Resolve Medium or higher product,
  UX, public-contract, dependency, scope and acceptance choices with the user.
  Reversible implementation details remain with the owner. Workers ask through
  the lead, which supplies approved facts or escalates missing decisions through
  the coordinator; do not repeat approved questions or infer user approval. Pause
  dependent work while a decision is pending; continue approved independent work.
- Route implementation and ordinary independent reviews to Luna High. Use Sol
  Medium, read-only, for simulation/contracts/parity, wallet
  ownership/persistence/settlement/deduplication, security, broad lifecycle or
  concurrency review, consequential feasibility uncertainty, and diagnosis
  after two failed repairs of one acceptance case. Never assign Sol code edits.
  Explain the model choice and do not silently substitute unavailable models.
  Repository files cannot switch the active chat model: select Luna High
  manually for coordinator and lead, then validate with a small pilot.
- When feasibility is uncertain, first run a bounded investigation producing
  constraints, a minimal reproducible case and open decisions. Use read-only Sol
  analysis before production changes when that uncertainty controls the design.
  Do not grow production code or a general-purpose test framework just to explore
  an unsettled requirement. Ordinary, understood changes do not need this gate.
- After feasibility is settled, deliver small, complete milestones. Each shared
  simulation milestone includes its TypeScript/Go behavior and affected parity
  checks; do not defer all native integration until the end. Keep unfinished rules
  unavailable for issuance until their consumers and settlement support are ready.
- Use the root model routing and `fork_turns="none"` with model overrides. Only
  the coordinator and lead delegate; workers must not spawn agents. Parallelize
  independent work only after interfaces and ownership are settled. Queue
  dependencies and respect actual runtime capacity; the current four-agent
  limit is environmental, not a permanent hardcoded process rule.
- Keep one implementation owner through understanding, TDD, implementation,
  focused checks, self-review and revisions. Add a second worker only for
  independent components with settled interfaces, separate ownership and a clear
  benefit. Do not split ordinary test writing from implementation.
- Assign one owner per edited file. Workers request reassignment before editing
  outside scope; they must not change branches, stage, commit, reset, restore or
  overwrite another person's or agent's work. The chat coordinator coordinates Git operations.
- Serialize overlapping files and shared generated artifacts. Use isolated
  worktrees when isolation materially helps, not automatically for every worker.
- Request reports at completed milestones, not after each edit. Reports include
  changed behavior, checks/results and open acceptance gaps. Report blockers,
  ownership conflicts, scope changes and larger discoveries immediately.
- During implementation, the lead resolves routine decisions and the coordinator resolves user choices and blockers without
  repeating the worker's investigation. Review the complete returned milestone;
  short coordination does not replace integration review.
- The worker owns routine implementation decisions within the settled contract.
  Use one concise brief and one consolidated review per milestone, rather than
  approvals after individual edits or a stream of coordinator algorithm patches.
  Report scope changes, blockers and the reassessment threshold promptly.
- Default milestone reports are about 500 words. Report blockers, choices,
  completion and handoffs immediately; otherwise summarize changed state about
  every five minutes while following host update guidance. Never create
  scheduled follow-ups without user authorization.
- Keep ignored per-feature observability in `.agent-workflow/` from the
  [templates](agent-workflow/README.md): one current status, decisions, evidence
  and event history. Include objective; branch/base and dirty state; file
  ownership; agent IDs and models; milestones, dependencies, blockers and next
  action; questions and approved source; exact commands, results, tested state
  and superseded evidence. Events record dispatch rationale/model/ownership/done
  criteria, blockers, choices, completions, handoffs, failures and escalations.
  Fresh-context briefs preserve decisions and evidence without replaying full
  history.
- `scripts/agent_workflow_report.py` summarizes only explicitly selected local
  JSONL paths. It reports the last cumulative token snapshot, latest input
  context observation separately, compactions, delegation/wait calls, elapsed
  time and output character counts. It does not sum snapshots or totals across
  overlapping/forked runs. Fork counters may already include inherited history;
  the reporter shows each selected run independently and reports parent/fork
  source markers when present. Overlap remains unknown unless directly observed.
  It does not estimate costs/allowances, inspect directories, or print
  transcripts. Worker token telemetry coverage remains unknown; completion alone
  does not establish it. Treat results as partial telemetry, never as an
  automatic budget or scheduler.

## Test assumptions

Read before expanding controller, simulation or load-test coverage.

Establish representative cases that validate the harness before scaling seeds,
transitions or runtime. For a flight controller, establish screen-edge visibility,
observation/reaction timing, requested speed, entry position/velocity, complete
pickup criteria and survival through the following exit. For other harnesses,
check the applicable inputs, timing, workload and success conditions; mark any
inapplicable assumptions explicitly.

Declare the required coverage matrix before searching or expanding cases. Retain
failures and report uncovered cells. Searching for successful examples can establish
an explicitly bounded witness, but cannot replace failing required cases or satisfy
coverage merely by asserting that some example of each type passed.

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

The coordinator reviews the complete milestone against acceptance criteria. Require one
batched independent Sol review for simulation behavior, shared contracts or TS/Go
parity; wallet persistence, ownership, settlement or deduplication; security; and
broad lifecycle/concurrency changes. Routine changes need an implementation owner,
independent Luna reviewer and coordinator integration review. Documentation-only
coordinator review needs link/diff inspection. Give independent reviewers the
requirements and complete diff. Reviewers inspect callers, tests and failure paths.
Consolidate findings into one revision
request to the existing Luna owner. Recheck changed paths and affected callers;
reopen broad review only when scope or evidence warrants it. Apply the root
verification requirements after integration and subsequent relevant edits.

For risky feasibility work, review the constraints and harness strategy early;
do not wait for full feature integration. Later integration review covers the
complete delivered milestone, with follow-up focused on changed assumptions and
paths rather than repeating unchanged analysis.

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

Obtain an independent, read-only diagnosis from Sol using the failing requirement,
minimal case and attempt evidence. No further implementation or controller tuning
on that failure proceeds while the diagnosis is pending. The coordinator records a materially
revised approach, a narrower deliverable or a requirement decision, then returns
implementation to Luna with one bounded discriminator. Another parameter change
or newly named subproblem is not sufficient to restart the same repair loop.
Ask the user only for changes to approved scope/requirements or a missing decision.
Reassessment does not waive acceptance requirements or authorize Sol code writing.

## Checkpoints

Read when starting multi-stage work, preparing reassessment, or handing off.

Maintain the canonical checkpoint at `.agent-workflow/<feature>/status.md`; the
feature lead owns it and the coordinator reconciles final integration status.
Keep one current document rather than an append-only transcript. If the checkout
is unavailable or unwritable, use one task-specific Markdown file in the system
temporary directory and record that fallback path. Include:

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

The feature lead owns the current checkpoint; worker reports supply updates and
the coordinator reconciles it at integration. At resume or a
checkout change, verify the actual worktree, branch or detached HEAD, dirty files,
live worker IDs and running jobs. Replace stale status instead of appending
contradictory histories. Stop the old owner before a fresh-context handoff; preserve
the contract and evidence, not every prior message. Capacity errors alone are not
evidence of context exhaustion or permission to change models.

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

A delegated coding timebox is a reporting checkpoint, not an enforced process
timeout. Distinguish a live agent from a running test process; verify its status
before saying work continues in the background. If neither remains active, report
the saved incomplete state and next action instead.
