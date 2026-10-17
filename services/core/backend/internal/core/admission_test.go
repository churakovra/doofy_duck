package core

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestUserMiddlewareWaitsForInflightSlot(t *testing.T) {
	server, handler, request := admissionTestHandler(t, time.Second)
	server.RequestSlots <- struct{}{}
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(response, request())
		close(done)
	}()

	select {
	case <-done:
		t.Fatalf("request returned before the in-flight slot was released: status=%d", response.Code)
	case <-time.After(20 * time.Millisecond):
	}

	<-server.RequestSlots
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("queued request did not proceed after the in-flight slot was released")
	}
	if response.Code != http.StatusNoContent {
		t.Fatalf("queued request status = %d, want 204", response.Code)
	}
}

func TestUserMiddlewareRejectsWhenAdmissionQueueIsFull(t *testing.T) {
	server, handler, request := admissionTestHandler(t, time.Second)
	server.RequestSlots <- struct{}{}
	server.QueuedRequests <- struct{}{}
	response := httptest.NewRecorder()
	started := time.Now()
	handler.ServeHTTP(response, request())
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "1" {
		t.Fatalf("full queue response status=%d retry=%q", response.Code, response.Header().Get("Retry-After"))
	}
	if time.Since(started) > 100*time.Millisecond {
		t.Fatalf("full queue rejection took %s, want an immediate response", time.Since(started))
	}
}

func TestUserMiddlewareRejectsAfterQueueWaitExpires(t *testing.T) {
	server, handler, request := admissionTestHandler(t, 20*time.Millisecond)
	server.RequestSlots <- struct{}{}
	response := httptest.NewRecorder()
	started := time.Now()
	handler.ServeHTTP(response, request())
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "1" {
		t.Fatalf("expired queue response status=%d retry=%q", response.Code, response.Header().Get("Retry-After"))
	}
	if elapsed := time.Since(started); elapsed < 20*time.Millisecond || elapsed > time.Second {
		t.Fatalf("queue wait = %s, want approximately 20ms", elapsed)
	}
	if len(server.QueuedRequests) != 0 {
		t.Fatalf("queued request count = %d after timeout, want 0", len(server.QueuedRequests))
	}
}

func TestUserMiddlewareRemovesCanceledRequestFromQueue(t *testing.T) {
	server, handler, request := admissionTestHandler(t, time.Second)
	server.RequestSlots <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(response, request().WithContext(ctx))
		close(done)
	}()
	until := time.Now().Add(time.Second)
	for len(server.QueuedRequests) == 0 && time.Now().Before(until) {
		time.Sleep(time.Millisecond)
	}
	if len(server.QueuedRequests) != 1 {
		cancel()
		t.Fatalf("queued request count = %d, want 1 before cancellation", len(server.QueuedRequests))
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("canceled queued request did not return promptly")
	}
	if len(server.QueuedRequests) != 0 {
		t.Fatalf("queued request count = %d after cancellation, want 0", len(server.QueuedRequests))
	}
}

func admissionTestHandler(t *testing.T, queueWait time.Duration) (*Server, http.Handler, func() *http.Request) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB:             &pgxpool.Pool{},
		Auth:           JWTVerifier{Keys: map[string]ed25519.PublicKey{"test": publicKey}},
		MaxInflight:    1,
		MaxQueued:      1,
		QueueWait:      queueWait,
		RequestSlots:   make(chan struct{}, 1),
		QueuedRequests: make(chan struct{}, 1),
	}
	handler := server.user(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	claims := map[string]any{
		"iss": "doofy-platform", "aud": "doofy-core",
		"sub": "00000000-0000-4000-8000-000000000001",
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(),
		"jti": "00000000-0000-4000-8000-000000000002", "scope": []string{"run:write"},
	}
	token := signedJWT(t, privateKey, "test", "EdDSA", claims)
	return server, handler, func() *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/runs/current", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		return req
	}
}
