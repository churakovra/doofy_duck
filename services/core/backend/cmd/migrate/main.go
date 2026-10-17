package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"doofyduck/core/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	url := os.Getenv("CORE_DATABASE_URL")
	if url == "" {
		slog.Error("missing required configuration", "name", "CORE_DATABASE_URL")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err == nil {
		err = pool.Ping(ctx)
	}
	if err == nil {
		err = migrations.Apply(ctx, pool)
	}
	if pool != nil {
		pool.Close()
	}
	if err != nil {
		slog.Error("Core migration failed", "stage", "database_migration")
		os.Exit(1)
	}
	slog.Info("Core database migrations applied")
}
