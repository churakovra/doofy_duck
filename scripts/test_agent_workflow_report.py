import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("agent_workflow_report.py")
SPEC = importlib.util.spec_from_file_location("agent_workflow_report", SCRIPT)
reporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reporter)


def record(kind, payload=None, timestamp="2026-10-19T10:00:00.000Z"):
    return {"type": kind, "timestamp": timestamp, "payload": payload or {}}


class WorkflowReportTests(unittest.TestCase):
    def report(self, *records):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.jsonl"
            path.write_text("\n".join(json.dumps(item) for item in records) + "\n")
            return reporter.summarize_paths([path])

    def test_actual_codex_event_schema_extracts_model_usage_tools_and_compaction(self):
        result = self.report(
            record("session_meta", {"id": "safe-id", "source": "vscode"}),
            record("turn_context", {"model": "gpt-6.1-sol", "effort": "medium"}),
            record("event_msg", {"type": "token_count", "info": {
                "total_token_usage": {"input_tokens": 107301536, "cached_input_tokens": 105267200, "output_tokens": 321847},
                "last_token_usage": {"input_tokens": 185674, "output_tokens": 494},
                "model_context_window": 475000,
            }}),
            record("response_item", {"type": "function_call", "name": "spawn_agent", "arguments": "{}"}),
            record("response_item", {"type": "function_call", "name": "followup_task", "arguments": "{}"}),
            record("response_item", {"type": "function_call", "name": "wait_agent", "arguments": "{}"}),
            record("compacted"),
        )
        run = result["runs"][0]
        self.assertEqual(run["model"], "gpt-6.1-sol")
        self.assertEqual(run["efforts"], ["medium"])
        self.assertEqual(run["event_total_usage"], {"input_tokens": 107301536, "cached_input_tokens": 105267200, "output_tokens": 321847})
        self.assertEqual(run["latest_input_tokens_observed"], 185674)
        self.assertEqual(run["model_context_window"], 475000)
        self.assertEqual(run["tool_calls"], {"spawn_agent": 1, "followup_task": 1, "wait_agent": 1})
        self.assertEqual(run["compactions"], 1)
        self.assertEqual(run["worker_coverage"], "unknown")

    def test_last_cumulative_snapshot_wins_and_thread_scope_stays_separate(self):
        result = self.report(
            record("event_msg", {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 10}}}),
            record("token_usage_record", {"thread_token_usage": {"input_tokens": 100}}),
            record("event_msg", {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 15}}}),
        )
        run = result["runs"][0]
        self.assertEqual(run["event_total_usage"]["input_tokens"], 15)
        self.assertEqual(run["thread_usage_record"]["input_tokens"], 100)
        self.assertNotIn("total_tokens", result)

    def test_overlapping_or_inherited_runs_are_never_aggregated(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "parent.jsonl"
            fork = Path(directory) / "fork.jsonl"
            parent.write_text(json.dumps(record("event_msg", {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 600}}})) + "\n")
            fork.write_text(json.dumps(record("session_meta", {"id": "fork", "parent_thread_id": "parent"})) + "\n" + json.dumps(record("event_msg", {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 650}}})) + "\n")
            result = reporter.summarize_paths([parent, fork])
        self.assertEqual([run["event_total_usage"]["input_tokens"] for run in result["runs"]], [600, 650])
        self.assertEqual(result["runs"][1]["inherited_history_marker"], "present")
        self.assertEqual(result["runs"][1]["overlap_status"], "unknown")

    def test_worker_completion_never_claims_worker_telemetry_coverage(self):
        result = self.report(
            record("response_item", {"type": "function_call", "name": "spawn_agent", "arguments": "{}"}),
            record("response_item", {"type": "agent_message", "message": "worker completed"}),
        )
        self.assertEqual(result["runs"][0]["worker_coverage"], "unknown")

    def test_timezone_less_timestamp_is_skipped_without_mixing_with_aware_times(self):
        result = self.report(
            record("session_meta", timestamp="2026-10-18T10:00:00"),
            record("turn_context", {"model": "gpt-6-luna"}, timestamp="2026-10-18T11:00:00Z"),
            record("compacted", timestamp="2026-10-18T12:00:00Z"),
        )
        run = result["runs"][0]
        self.assertEqual(run["elapsed_seconds"], 3600)
        self.assertEqual(run["record_errors"], 1)

    def test_malformed_tool_name_counts_an_error_without_crashing(self):
        result = self.report(
            record("response_item", {"type": "function_call", "name": [], "arguments": "{}"}),
            record("response_item", {"type": "function_call", "name": "spawn_agent", "arguments": "{}"}),
        )
        run = result["runs"][0]
        self.assertEqual(run["tool_calls"], {"spawn_agent": 1})
        self.assertEqual(run["record_errors"], 1)

    def test_malformed_missing_and_unrecognized_records_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "partial.jsonl"
            path.write_text('{"type":"future_schema","payload":{}}\n{broken\n{"type":')
            missing = Path(directory) / "missing.jsonl"
            result = reporter.summarize_paths([path, missing])
        self.assertEqual(result["runs"][0]["record_errors"], 2)
        self.assertEqual(result["runs"][0]["unrecognized_record_types"], ["future_schema"])
        self.assertEqual(len(result["missing_paths"]), 1)

    def test_oversized_records_are_skipped_and_reported(self):
        original_limit = reporter.MAX_RECORD_CHARS
        reporter.MAX_RECORD_CHARS = 180
        try:
            result = self.report(
                {"type": "metadata", "padding": "x" * 300},
                record("turn_context", {"model": "gpt-6-luna"}),
            )
        finally:
            reporter.MAX_RECORD_CHARS = original_limit
        self.assertEqual(result["runs"][0]["oversized_records"], 1)
        self.assertEqual(result["runs"][0]["model"], "gpt-6-luna")

    def test_record_limit_is_reported_instead_of_claiming_complete_coverage(self):
        original_limit = reporter.MAX_RECORDS_PER_FILE
        reporter.MAX_RECORDS_PER_FILE = 1
        try:
            result = self.report(record("session_meta"), record("turn_context", {"model": "gpt-6-luna"}))
        finally:
            reporter.MAX_RECORDS_PER_FILE = original_limit
        self.assertTrue(result["runs"][0]["record_limit_reached"])
        self.assertIsNone(result["runs"][0]["model"])

    def test_output_is_private_and_counts_text_without_rendering_it(self):
        result = self.report(
            record("response_item", {"type": "function_call_output", "output": "PRIVATE_TRANSCRIPT"}),
            record("response_item", {"type": "custom_tool_call_output", "output": [{"type": "input_text", "text": "SECRET"}]}),
        )
        output = json.dumps(result) + reporter.render_text(result)
        self.assertNotIn("PRIVATE_TRANSCRIPT", output)
        self.assertNotIn("SECRET", output)
        self.assertEqual(result["runs"][0]["tool_output_chars"], 24)


if __name__ == "__main__":
    unittest.main()
