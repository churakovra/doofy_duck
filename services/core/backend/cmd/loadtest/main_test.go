package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCompletionAcceptedRequiresVerifiedDeliveredReceipt(t *testing.T) {
	tests := []struct {
		name string
		run  snapshot
		want bool
	}{
		{name: "verified and delivered", run: snapshot{Status: "completed", Verification: "verified", Delivery: "delivered"}, want: true},
		{name: "rejected", run: snapshot{Status: "rejected", Verification: "rejected", Delivery: "rejected"}},
		{name: "completed but delivery rejected", run: snapshot{Status: "completed", Verification: "verified", Delivery: "rejected"}},
		{name: "completed but still pending", run: snapshot{Status: "completed", Verification: "verified", Delivery: "pending"}},
		{name: "completion pending", run: snapshot{Status: "completion_pending", Verification: "verified", Delivery: "pending"}},
		{name: "in progress", run: snapshot{Status: "active", Verification: "in_progress", Delivery: "not_ready"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := completionAccepted(tt.run); got != tt.want {
				t.Fatalf("completionAccepted(%+v) = %t, want %t", tt.run, got, tt.want)
			}
		})
	}
}

func TestAwaitCompletionRejectsAbandonedAndRejectedRuns(t *testing.T) {
	for _, status := range []string{"rejected", "abandoned"} {
		t.Run(status, func(t *testing.T) {
			body := fmt.Sprintf(`{"status":%q,"verificationStatus":"rejected","deliveryStatus":"rejected"}`, status)
			client := responseClient(http.StatusOK, body)
			_, err := awaitCompletion(client, "http://core.invalid", "", 1, "token", "run-id", time.Now().Add(time.Second), &metrics{})
			if err == nil || !strings.Contains(err.Error(), status) {
				t.Fatalf("awaitCompletion error = %v, want terminal %s failure", err, status)
			}
		})
	}
}

func TestAwaitCompletionAcceptsOnlyDeliveredVerifiedRun(t *testing.T) {
	client := responseClient(http.StatusOK, `{"status":"completed","verificationStatus":"verified","deliveryStatus":"delivered"}`)
	if _, err := awaitCompletion(client, "http://core.invalid", "", 1, "token", "run-id", time.Now().Add(time.Second), &metrics{}); err != nil {
		t.Fatalf("awaitCompletion returned error: %v", err)
	}
}

type stalledTransport struct{}

func (stalledTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	<-req.Context().Done()
	return nil, req.Context().Err()
}

func TestAwaitCompletionBoundsStalledRequest(t *testing.T) {
	client := &http.Client{Transport: stalledTransport{}}
	start := time.Now()
	_, err := awaitCompletion(client, "http://core.invalid", "", 1, "token", "run-id", start.Add(100*time.Millisecond), &metrics{})
	if err == nil {
		t.Fatal("stalled completion unexpectedly succeeded")
	}
	if time.Since(start) > time.Second {
		t.Fatal("completion request exceeded deadline")
	}
}

type responseTransport struct {
	status int
	body   string
}

func (transport responseTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: transport.status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(transport.body)),
	}, nil
}

func responseClient(status int, body string) *http.Client {
	return &http.Client{Transport: responseTransport{status: status, body: body}}
}

func TestCreateOrTakeoverRunRetriesRateLimit(t *testing.T) {
	transport := &sequenceTransport{responses: []http.Response{
		{StatusCode: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusCreated, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"runId":"run-1","writerToken":"writer-1"}`))},
	}}
	client := &http.Client{Transport: transport}
	var m metrics

	run, err := createOrTakeoverRun(client, "http://core.invalid", "", 123, "token", time.Now().Add(3*time.Second), &m)
	if err != nil {
		t.Fatalf("createOrTakeoverRun returned error: %v", err)
	}
	if run.RunID != "run-1" || run.WriterToken != "writer-1" {
		t.Fatalf("created run = %+v, want run-1 with writer token", run)
	}
	if got := transport.callCount(); got != 2 {
		t.Fatalf("request count = %d, want one retry after 429", got)
	}
	if got := m.retried; got != 1 {
		t.Fatalf("retry count = %d, want 1", got)
	}
}

func TestAuthTokenRetriesTransientRateLimit(t *testing.T) {
	transport := &sequenceTransport{responses: []http.Response{
		{StatusCode: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"access_token":"access-1"}`))},
	}}
	var m metrics

	token, err := authTokenUntil(&http.Client{Transport: transport}, "http://platform.invalid", 123, time.Now().Add(3*time.Second), &m)
	if err != nil {
		t.Fatalf("authTokenUntil returned error: %v", err)
	}
	if token != "access-1" {
		t.Fatalf("access token = %q, want access-1", token)
	}
	if got := transport.callCount(); got != 2 {
		t.Fatalf("request count = %d, want one retry after 429", got)
	}
	if got := m.startupRetries; got != 1 {
		t.Fatalf("startup retry count = %d, want 1", got)
	}
}

type sequenceTransport struct {
	mu        sync.Mutex
	responses []http.Response
	calls     int
}

func (transport *sequenceTransport) RoundTrip(*http.Request) (*http.Response, error) {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	transport.calls++
	if len(transport.responses) == 0 {
		return nil, fmt.Errorf("unexpected request")
	}
	response := transport.responses[0]
	transport.responses = transport.responses[1:]
	return &response, nil
}

func (transport *sequenceTransport) callCount() int {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	return transport.calls
}

func TestReconnectDelaySpreadsAcrossClients(t *testing.T) {
	end := time.Unix(100, 0)
	spread := time.Minute
	wants := []time.Duration{0, 15 * time.Second, 30 * time.Second, 45 * time.Second, time.Minute}
	for index, want := range wants {
		got := reconnectDelay(index, len(wants), spread)
		if got != want {
			t.Errorf("reconnectDelay(%d, %d, %s) = %s, want %s", index, len(wants), spread, got, want)
		}
		if gotAt := end.Add(got); gotAt.Before(end) {
			t.Errorf("client %d reconnects before outage end: %s", index, gotAt)
		}
	}
	if got := reconnectDelay(0, 1, spread); got != 0 {
		t.Fatalf("single-client reconnect delay = %s, want 0", got)
	}
}

func TestClientStartDelaySpreadsInitialCheckpointPhase(t *testing.T) {
	interval := 2 * time.Second
	wants := []time.Duration{0, 400 * time.Millisecond, 800 * time.Millisecond, 1200 * time.Millisecond, 1600 * time.Millisecond}
	for index, want := range wants {
		if got := clientStartDelay(index, len(wants), interval); got != want {
			t.Errorf("clientStartDelay(%d, %d, %s) = %s, want %s", index, len(wants), interval, got, want)
		}
	}
	if got := clientStartDelay(0, 1, interval); got != 0 {
		t.Fatalf("single-client start delay = %s, want 0", got)
	}
}

func TestStartupRetryDelayHonorsRetryAfterAndAddsJitter(t *testing.T) {
	backoff := 200 * time.Millisecond
	retryAfter := 2 * time.Second
	delay := startupRetryDelay(123, 4, backoff, retryAfter)
	if delay < retryAfter || delay > retryAfter+backoff/2 {
		t.Fatalf("startupRetryDelay = %s, want Retry-After %s plus bounded jitter", delay, retryAfter)
	}
	if got := parseRetryAfter("1", time.Now()); got != time.Second {
		t.Fatalf("parseRetryAfter seconds = %s, want 1s", got)
	}
}

func TestCheckpointFailureFractionThreshold(t *testing.T) {
	tests := []struct {
		name     string
		failures int64
		requests int64
		maximum  float64
		wantFail bool
	}{
		{name: "below one percent", failures: 194, requests: 29194, maximum: .01, wantFail: false},
		{name: "above one percent", failures: 2, requests: 100, maximum: .01, wantFail: true},
		{name: "exact threshold passes", failures: 1, requests: 100, maximum: .01, wantFail: false},
		{name: "no requests", failures: 0, requests: 0, maximum: .01, wantFail: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := checkpointFailureFractionExceeded(tt.failures, tt.requests, tt.maximum); got != tt.wantFail {
				t.Fatalf("checkpoint failure threshold result = %t, want %t", got, tt.wantFail)
			}
		})
	}
}

func TestSubmitCheckpointCountsRateLimitAsFailedAttempt(t *testing.T) {
	transport := &sequenceTransport{responses: []http.Response{
		{StatusCode: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"0"}}, Body: io.NopCloser(strings.NewReader(""))},
		{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"runId":"run-1"}`))},
	}}
	var m metrics

	_, _, err := submitCheckpoint(&http.Client{Transport: transport}, "http://core.invalid", "", 123, "token", "run-1", checkpoint{}, time.Now().Add(3*time.Second), &m)
	if err != nil {
		t.Fatalf("submitCheckpoint returned error: %v", err)
	}
	if m.requests != 2 || m.checkpointFailures != 1 || m.rateLimited != 1 {
		t.Fatalf("request metrics = attempts:%d failures:%d rate_limited:%d; want 2, 1, 1", m.requests, m.checkpointFailures, m.rateLimited)
	}
}
