package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"doofyduck/core/internal/core"
	"doofyduck/core/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	databaseURL := os.Getenv("CORE_DATABASE_URL")
	if databaseURL == "" {
		logger.Error("missing required configuration", "name", "CORE_DATABASE_URL")
		os.Exit(2)
	}
	keys, err := publicKeys(os.Getenv("ACCESS_TOKEN_PUBLIC_KEYS_JSON"))
	if err != nil {
		logger.Error("invalid ACCESS_TOKEN_PUBLIC_KEYS_JSON configuration")
		os.Exit(2)
	}
	platformURL := strings.TrimRight(os.Getenv("CORE_PLATFORM_COMPLETION_URL"), "/")
	serviceToken := os.Getenv("CORE_TO_PLATFORM_TOKEN")
	operatorToken := os.Getenv("CORE_OPERATOR_TOKEN")
	if platformURL == "" || serviceToken == "" || operatorToken == "" {
		logger.Error("missing required Core service configuration", "names", "CORE_PLATFORM_COMPLETION_URL, CORE_TO_PLATFORM_TOKEN, CORE_OPERATOR_TOKEN")
		os.Exit(2)
	}
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		logger.Error("invalid database configuration")
		os.Exit(2)
	}
	poolConfig.MaxConns = maxConnections()
	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		logger.Error("database pool setup failed")
		os.Exit(1)
	}
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	err = pool.Ping(ctx)
	if err == nil && os.Getenv("CORE_AUTO_MIGRATE") == "true" {
		err = migrations.Apply(ctx, pool)
	}
	cancel()
	if err != nil {
		logger.Error("database initialization failed")
		os.Exit(1)
	}
	server := &core.Server{DB: pool, Auth: core.JWTVerifier{Keys: keys}, OperatorToken: operatorToken, OutboxConfigured: platformURL != "" && serviceToken != "", MaxInflight: maxInflight()}
	mux := server.Handler()
	httpServer := &http.Server{Addr: listenAddress(), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	worker := &core.CompletionWorker{DB: pool, Endpoint: platformURL, ServiceToken: serviceToken, Client: &http.Client{Timeout: 6 * time.Second}}
	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	go worker.RunConcurrent(workerCtx, time.Second, outboxWorkers())
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveErr := make(chan error, 1)
	go func() {
		logger.Info("Core HTTP server starting", "address", httpServer.Addr)
		serveErr <- httpServer.ListenAndServe()
	}()
	select {
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("Core HTTP server stopped", "error", err.Error())
			os.Exit(1)
		}
	case <-signalCtx.Done():
	}
	stopWorker()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("Core HTTP shutdown failed", "error", err.Error())
	}
}

func publicKeys(raw string) (map[string]ed25519.PublicKey, error) {
	var encoded map[string]string
	if err := json.Unmarshal([]byte(raw), &encoded); err != nil || len(encoded) == 0 {
		return nil, errors.New("CORE_JWT_PUBLIC_KEYS must be a nonempty JSON object of kid to base64url key")
	}
	keys := make(map[string]ed25519.PublicKey, len(encoded))
	for kid, value := range encoded {
		key, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil || len(key) != ed25519.PublicKeySize || strings.TrimSpace(kid) == "" {
			return nil, errors.New("each JWT key must be a 32-byte raw Ed25519 public key")
		}
		keys[kid] = ed25519.PublicKey(key)
	}
	return keys, nil
}
func listenAddress() string {
	host := os.Getenv("CORE_LISTEN_ADDR")
	if host == "" {
		return ":8080"
	}
	return host
}

func maxConnections() int32 {
	value := os.Getenv("CORE_DB_MAX_CONNECTIONS")
	if value == "" {
		return 32
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 2 || n > 256 {
		return 32
	}
	return int32(n)
}

func outboxWorkers() int {
	value := os.Getenv("CORE_OUTBOX_WORKERS")
	if value == "" {
		return 4
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > 32 {
		return 4
	}
	return n
}

func maxInflight() int {
	value := os.Getenv("CORE_MAX_INFLIGHT_REQUESTS")
	if value == "" {
		return 256
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > 4096 {
		return 256
	}
	return n
}
