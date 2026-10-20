# Workflow telemetry reporter

The optional `scripts/agent_workflow_report.py` command summarizes only the
explicitly selected local JSONL session paths. It does not discover session files
or recurse through directories.

```sh
python3 scripts/agent_workflow_report.py --format text /path/to/run.jsonl
python3 scripts/agent_workflow_report.py --format json /path/to/run.jsonl /path/to/worker.jsonl
```

The report recognizes session metadata, turn context, token snapshots, tool
calls/outputs and compaction events. It reports per-run observations, does not
sum overlapping or forked runs, and does not print transcripts or tool output
text. Missing or unknown data is reported as incomplete; counters are partial
telemetry, not cost, allowance or scheduler estimates.
