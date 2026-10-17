package core

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestCompletionDeliveryLogContainsSafeBoundedOutcomeFields(t *testing.T) {
	var logs bytes.Buffer
	worker := &CompletionWorker{Logger: slog.New(slog.NewJSONHandler(&logs, nil))}
	worker.logDispatch(leasedEvent{
		EventID:  "00000000-0000-4000-8000-000000000001",
		RunID:    "00000000-0000-4000-8000-000000000002",
		Attempts: 2,
	}, "pending_retry", 503, "remote_retryable_status")

	var event map[string]any
	if err := json.Unmarshal(logs.Bytes(), &event); err != nil {
		t.Fatalf("outbox log is not JSON: %v; output=%q", err, logs.String())
	}
	if event["event_id"] != "00000000-0000-4000-8000-000000000001" || event["run_id"] != "00000000-0000-4000-8000-000000000002" || event["status"] != "pending_retry" || event["http_status"] != float64(503) || event["attempt"] != float64(3) || event["reason"] != "remote_retryable_status" {
		t.Fatalf("unexpected outbox log fields: %#v", event)
	}
	for _, secret := range []string{"remote error body", "Bearer", "database://"} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("outbox log contains sensitive value %q: %s", secret, logs.String())
		}
	}
}

func TestCompletionWorkerFailureLogDoesNotIncludeDatabaseError(t *testing.T) {
	var logs bytes.Buffer
	worker := &CompletionWorker{Logger: slog.New(slog.NewJSONHandler(&logs, nil))}
	worker.logWorkerFailure()
	var event map[string]any
	if err := json.Unmarshal(logs.Bytes(), &event); err != nil {
		t.Fatalf("worker failure log is not JSON: %v; output=%q", err, logs.String())
	}
	if event["msg"] != "completion_dispatch_failed" || event["status"] != "retrying" || event["reason"] != "dispatch_failed" {
		t.Fatalf("unexpected worker failure fields: %#v", event)
	}
	if strings.Contains(logs.String(), "database://") || strings.Contains(logs.String(), "password") {
		t.Fatalf("worker failure log contains sensitive details: %s", logs.String())
	}
}
