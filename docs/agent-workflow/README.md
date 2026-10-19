# Agent workflow records

Copy the templates into a feature-specific directory beneath the ignored
`.agent-workflow/` root. The lead-owned `.agent-workflow/<feature>/status.md` is
the canonical checkpoint; the coordinator reconciles it during integration.
Keep one current status, decisions and evidence file; events are a concise
history of meaningful state changes. Do not put credentials, private transcripts
or full tool output in these records. Link a bounded log or reproducible local
path when needed.

Start with [status](status-template.md), [decisions](decisions-template.md),
[evidence](evidence-template.md) and [events](events-template.md). Use the
[role brief](role-template.md) and [assignment brief](assignment-template.md)
when dispatching work.

## Roles

| Role | Owns | Does not do |
| --- | --- | --- |
| Chat coordinator | User decisions and communication, Git operations, final integration and reporting | Application code, tests, scripts or tooling edits |
| Feature lead | Whole-feature plan, acceptance/interfaces, dependencies, file ownership, decisions, canonical checkpoint; dispatches owners/reviewers | Git operations or silently deciding Medium+ questions |
| Implementation owner | One milestone through TDD, checks, self-review and revisions | Delegating, editing unowned files, or changing Git state |
| Independent reviewer | Review the complete milestone against criteria and report findings | Editing implementation or delegating |
| Sol reviewer | Read-only high-risk review, consequential feasibility, or diagnosis after two failed repairs | Code changes or implementation ownership |

## Reporter

Pass one or more exact local JSONL paths. The command does not discover session
files or recurse into directories:

```sh
python3 scripts/agent_workflow_report.py --format text /path/to/run.jsonl
python3 scripts/agent_workflow_report.py --format json /path/to/run.jsonl /path/to/worker.jsonl
```

It recognizes Codex session metadata, turn context, `event_msg` token-count
snapshots, `token_usage_record`, response-item tool calls and outputs, and
`compacted` events. It reports latest cumulative event counters and thread usage
separately because they can have different scopes. Fork counters may include
inherited history; runs are never summed. A context input observation and model
window are shown separately without claiming exact active context size. Worker
completion does not establish worker token telemetry coverage, which remains
unknown. Overlap remains unknown unless the source exposes it. Output contains
counts and metadata, never transcripts or tool output text. Unknown schemas and
missing, malformed, oversized or capped input are called out. Counters are
partial observations, not cost, allowance, budget, or scheduler estimates.

## Workflow pilot

Before relying on the process, walk through a routine milestone, independent
parallel milestones after ownership is settled, an ownership conflict routed to
the lead, a pending Medium+ choice that pauses dependent work, an applicable
read-only Sol gate, the same acceptance case failing two repair attempts, and a
handoff that resumes from the canonical status checkpoint. In every case,
continue approved independent work and preserve exact evidence and next action.
