package core

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func telemetryEvents(t *testing.T, logs *bytes.Buffer) []map[string]any {
	t.Helper()
	var events []map[string]any
	decoder := json.NewDecoder(logs)
	for decoder.More() {
		var event map[string]any
		if err := decoder.Decode(&event); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	return events
}

func TestAdmissionTelemetryOutcomes(t *testing.T) {
	for _, outcome := range []string{"admitted", "queue_full", "timeout", "canceled"} {
		t.Run(outcome, func(t *testing.T) {
			server, handler, request := admissionTestHandler(t, 10*time.Millisecond)
			var logs bytes.Buffer
			server.Logger = slog.New(slog.NewJSONHandler(&logs, nil))
			if outcome != "admitted" {
				server.RequestSlots <- struct{}{}
			}
			if outcome == "queue_full" {
				server.QueuedRequests <- struct{}{}
			}
			req := request()
			if outcome == "canceled" {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				req = req.WithContext(ctx)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			events := telemetryEvents(t, &logs)
			found := false
			for _, event := range events {
				if event["msg"] == "admission_state" && event["outcome"] == outcome {
					found = true
					if event["active"] != float64(1) || (outcome != "queue_full" && event["waiting"] != float64(0)) {
						t.Fatalf("unexpected occupancy: %#v", event)
					}
					if outcome == "timeout" && event["wait_ms"].(float64) < 10 {
						t.Fatalf("timeout wait missing: %#v", event)
					}
				}
			}
			if !found {
				t.Fatalf("missing %s: %#v", outcome, events)
			}
			if outcome == "admitted" && response.Code != http.StatusNoContent {
				t.Fatalf("status %d", response.Code)
			}
		})
	}
}

func TestDeliveryAgeTelemetry(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	var logs bytes.Buffer
	worker := CompletionWorker{Logger: slog.New(slog.NewJSONHandler(&logs, nil)), Now: func() time.Time { return now }}
	worker.logDeliveryAge(leasedEvent{CreatedAt: now.Add(-3 * time.Second)}, "delivered")
	worker.logDeliveryAge(leasedEvent{CreatedAt: now.Add(time.Second)}, "delivered")
	events := telemetryEvents(t, &logs)
	if len(events) != 2 || events[0]["age_ms"] != float64(3000) || events[1]["age_ms"] != float64(0) {
		t.Fatalf("unexpected age events: %#v", events)
	}
	for _, event := range events {
		if event["msg"] != "completion_delivery_age" || event["outcome"] != "delivered" || event["event_id"] != nil || event["run_id"] != nil {
			t.Fatalf("unexpected fields: %#v", event)
		}
	}
}
