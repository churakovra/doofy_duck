package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRequestLogsSafeCanonicalOutcomeAndGeneratedCorrelation(t *testing.T) {
	var logs bytes.Buffer
	server := &Server{Logger: slog.New(slog.NewJSONHandler(&logs, nil))}
	handler := server.Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/runs/current?secret=query-secret", nil)
	req.Header.Set("Authorization", "Bearer credential-secret")
	req.Header.Set("X-Request-ID", "malicious supplied id")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.Code)
	}
	requestID := response.Header().Get("X-Request-ID")
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).MatchString(requestID) {
		t.Fatalf("invalid generated correlation ID %q", requestID)
	}
	var event map[string]any
	if err := json.Unmarshal(logs.Bytes(), &event); err != nil {
		t.Fatalf("request log is not JSON: %v; output=%q", err, logs.String())
	}
	if event["request_id"] != requestID || event["method"] != "GET" || event["route"] != "GET /api/v1/runs/current" || event["status"] != float64(503) {
		t.Fatalf("unexpected request log fields: %#v", event)
	}
	if _, ok := event["duration_ms"]; !ok {
		t.Fatalf("request duration missing: %#v", event)
	}
	for _, secret := range []string{"query-secret", "credential-secret", "malicious supplied id", "/api/v1/runs/current?"} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("request log contains sensitive or noncanonical data %q: %s", secret, logs.String())
		}
	}
}

func TestRequestLogsUseUnmatchedRouteNotRawPath(t *testing.T) {
	var logs bytes.Buffer
	server := &Server{Logger: slog.New(slog.NewJSONHandler(&logs, nil))}
	handler := server.Handler()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/users/private-value?token=secret", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.Code)
	}
	if strings.Contains(logs.String(), "private-value") || strings.Contains(logs.String(), "secret") || !strings.Contains(logs.String(), `"route":"unmatched"`) {
		t.Fatalf("unsafe unmatched route log: %s", logs.String())
	}
}

func TestRequestLogsCorrelateCapacityRejection(t *testing.T) {
	var logs bytes.Buffer
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB:          &pgxpool.Pool{},
		Logger:      slog.New(slog.NewJSONHandler(&logs, nil)),
		Auth:        JWTVerifier{Keys: map[string]ed25519.PublicKey{"test": publicKey}},
		MaxInflight: 1,
	}
	handler := server.Handler()
	server.RequestSlots <- struct{}{}
	claims := map[string]any{
		"iss": "doofy-platform", "aud": "doofy-core",
		"sub": "00000000-0000-4000-8000-000000000001",
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(),
		"jti": "00000000-0000-4000-8000-000000000002", "scope": []string{"run:write"},
	}
	requestID := "00000000-0000-4000-8000-000000000003"
	req := httptest.NewRequest(http.MethodGet, "/api/v1/runs/current", nil)
	req.Header.Set("Authorization", "Bearer "+signedJWT(t, privateKey, "test", "EdDSA", claims))
	req.Header.Set("X-Request-ID", requestID)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusTooManyRequests || response.Header().Get("X-Request-ID") != requestID {
		t.Fatalf("capacity response status=%d request_id=%q", response.Code, response.Header().Get("X-Request-ID"))
	}
	if !strings.Contains(logs.String(), `"status":429`) || !strings.Contains(logs.String(), `"request_id":"`+requestID+`"`) {
		t.Fatalf("capacity outcome not correlated in safe log: %s", logs.String())
	}
}
