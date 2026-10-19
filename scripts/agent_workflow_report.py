#!/usr/bin/env python3
"""Summarize explicitly selected Codex JSONL run logs without exposing transcripts."""

import argparse
import json
from datetime import datetime
from pathlib import Path

MAX_FILES = 64
MAX_RECORD_CHARS = 1_000_000
MAX_RECORDS_PER_FILE = 100_000
TOKEN_FIELDS = (
    "input_tokens", "cached_input_tokens", "cache_write_input_tokens",
    "output_tokens", "reasoning_output_tokens", "total_tokens",
)
CALL_NAMES = {"spawn_agent", "followup_task", "wait_agent", "wait_threads"}
KNOWN_RECORD_TYPES = {
    "session_meta", "event_msg", "response_item", "turn_context",
    "token_usage_record", "compacted", "world_state", "retained_context",
    "inter_agent_communication_metadata",
}


def _timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        return parsed
    except ValueError:
        return None


def _token_fields(value):
    if not isinstance(value, dict):
        return None
    return {key: value[key] for key in TOKEN_FIELDS if isinstance(value.get(key), (int, float))}


def _has_inheritance_marker(value):
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).lower()
            if ("parent" in normalized or "fork" in normalized) and child not in (None, False, "", [], {}):
                return True
            if _has_inheritance_marker(child):
                return True
    elif isinstance(value, list):
        return any(_has_inheritance_marker(item) for item in value)
    return False


def _new_run(path):
    return {
        "source": Path(path).name,
        "schema_status": "recognized",
        "model": None,
        "efforts": [],
        "elapsed_seconds": None,
        "event_total_usage": None,
        "latest_input_tokens_observed": None,
        "model_context_window": None,
        "thread_usage_record": None,
        "counter_scope": "per selected log; may include inherited/fork history",
        "inherited_history_marker": "not_observed",
        "overlap_status": "unknown",
        "compactions": 0,
        "tool_calls": {},
        "tool_call_records_observed": 0,
        "tool_output_chars": None,
        "tool_output_records_observed": 0,
        "worker_coverage": "unknown",
        "record_errors": 0,
        "oversized_records": 0,
        "record_limit_reached": False,
        "unrecognized_record_types": [],
    }


def _output_char_count(value):
    if isinstance(value, str):
        return len(value)
    if isinstance(value, list):
        return sum(len(item.get("text", "")) for item in value
                   if isinstance(item, dict) and isinstance(item.get("text"), str))
    return 0


def _summarize_path(path):
    run = _new_run(path)
    try:
        stream = Path(path).open("r", encoding="utf-8", errors="replace")
    except OSError:
        return None

    timestamps = []
    models = []
    efforts = []
    seen_types = set()
    with stream:
        for record_number in range(MAX_RECORDS_PER_FILE):
            line = stream.readline(MAX_RECORD_CHARS + 1)
            if not line:
                break
            if len(line) > MAX_RECORD_CHARS:
                run["oversized_records"] += 1
                while line and not line.endswith("\n"):
                    line = stream.readline(MAX_RECORD_CHARS + 1)
                continue
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                run["record_errors"] += 1
                continue
            if not isinstance(record, dict):
                run["record_errors"] += 1
                continue
            record_type = record.get("type")
            if isinstance(record_type, str):
                seen_types.add(record_type)
                if record_type not in KNOWN_RECORD_TYPES:
                    run["unrecognized_record_types"].append(record_type)
            payload = record.get("payload")
            if not isinstance(payload, dict):
                payload = {}
            stamp = _timestamp(record.get("timestamp"))
            if stamp:
                timestamps.append(stamp)
            elif isinstance(record.get("timestamp"), str):
                run["record_errors"] += 1

            if record_type == "session_meta":
                if _has_inheritance_marker(payload):
                    run["inherited_history_marker"] = "present"
            elif record_type == "turn_context":
                if isinstance(payload.get("model"), str):
                    models.append(payload["model"])
                effort = payload.get("effort", payload.get("reasoning_effort"))
                if isinstance(effort, str):
                    efforts.append(effort)
            elif record_type == "event_msg" and payload.get("type") == "token_count":
                info = payload.get("info")
                if isinstance(info, dict):
                    total = _token_fields(info.get("total_token_usage"))
                    last = _token_fields(info.get("last_token_usage"))
                    if total is not None:
                        run["event_total_usage"] = total
                    if last is not None:
                        run["latest_input_tokens_observed"] = last.get("input_tokens")
                    window = info.get("model_context_window")
                    if isinstance(window, (int, float)):
                        run["model_context_window"] = window
            elif record_type == "token_usage_record":
                usage = _token_fields(payload.get("thread_token_usage"))
                if usage is not None:
                    run["thread_usage_record"] = usage
            elif record_type == "compacted":
                run["compactions"] += 1
            elif record_type == "response_item":
                item_type = payload.get("type")
                if item_type in ("function_call", "custom_tool_call"):
                    run["tool_call_records_observed"] += 1
                    name = payload.get("name")
                    if isinstance(name, str):
                        if name in CALL_NAMES:
                            run["tool_calls"][name] = run["tool_calls"].get(name, 0) + 1
                    else:
                        run["record_errors"] += 1
                elif item_type in ("function_call_output", "custom_tool_call_output"):
                    run["tool_output_records_observed"] += 1
                    if run["tool_output_chars"] is None:
                        run["tool_output_chars"] = 0
                    run["tool_output_chars"] += _output_char_count(payload.get("output"))
        else:
            run["record_limit_reached"] = True

    if timestamps:
        run["elapsed_seconds"] = round((max(timestamps) - min(timestamps)).total_seconds(), 3)
    run["model"] = models[-1] if models else None
    run["efforts"] = sorted(set(efforts))
    run["unrecognized_record_types"] = sorted(set(run["unrecognized_record_types"]))
    if not seen_types.intersection(KNOWN_RECORD_TYPES):
        run["schema_status"] = "unrecognized"
    return run


def summarize_paths(paths):
    selected_paths = list(paths)
    result = {"runs": [], "missing_paths": [], "selection_limit_exceeded": False}
    if len(selected_paths) > MAX_FILES:
        result["selection_limit_exceeded"] = True
        selected_paths = selected_paths[:MAX_FILES]
    for path in selected_paths:
        run = _summarize_path(path)
        if run is None:
            result["missing_paths"].append(Path(path).name)
        else:
            result["runs"].append(run)
    return result


def render_text(result):
    lines = ["Agent workflow report (explicitly selected logs only)"]
    for run in result["runs"]:
        lines.append(f"{run['source']}: schema={run['schema_status']} model={run['model'] or 'unknown'} efforts={','.join(run['efforts']) or 'unknown'} elapsed={run['elapsed_seconds'] if run['elapsed_seconds'] is not None else 'unknown'}s")
        lines.append(f"  latest cumulative event counters: {json.dumps(run['event_total_usage'], sort_keys=True) if run['event_total_usage'] is not None else 'unobserved'}")
        lines.append(f"  latest input tokens observed={run['latest_input_tokens_observed'] if run['latest_input_tokens_observed'] is not None else 'unobserved'}; model context window={run['model_context_window'] if run['model_context_window'] is not None else 'unobserved'}")
        lines.append(f"  separate thread usage snapshot: {json.dumps(run['thread_usage_record'], sort_keys=True) if run['thread_usage_record'] is not None else 'unobserved'}; inherited marker={run['inherited_history_marker']}; overlap={run['overlap_status']}")
        lines.append(f"  compactions={run['compactions']} tool_calls={json.dumps(run['tool_calls'], sort_keys=True)} tool_output_chars={run['tool_output_chars'] if run['tool_output_chars'] is not None else 'unobserved'} worker_coverage={run['worker_coverage']}")
        lines.append(f"  record_errors={run['record_errors']} oversized={run['oversized_records']} record_limit_reached={run['record_limit_reached']} unrecognized_types={json.dumps(run['unrecognized_record_types'])}")
    lines.append(f"missing selected paths={len(result['missing_paths'])}; selection_limit_exceeded={result['selection_limit_exceeded']}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=("text", "json"), default="text")
    parser.add_argument("paths", nargs="+", help="explicit local JSONL paths; no directory or session discovery")
    args = parser.parse_args()
    result = summarize_paths(args.paths)
    print(json.dumps(result, indent=2, sort_keys=True) if args.format == "json" else render_text(result))


if __name__ == "__main__":
    main()
