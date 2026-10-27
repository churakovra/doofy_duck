package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CompletionWorker struct {
	DB           *pgxpool.Pool
	Logger       *slog.Logger
	Client       *http.Client
	Endpoint     string
	ServiceToken string
	Now          func() time.Time
}

type leasedEvent struct {
	EventID, RunID, LeaseToken string
	Body                       []byte
	Attempts                   int
	CreatedAt                  time.Time
}

func (w *CompletionWorker) DispatchOne(ctx context.Context) (bool, error) {
	if w.DB == nil || w.Endpoint == "" || w.ServiceToken == "" {
		return false, fmt.Errorf("completion delivery is not configured")
	}
	now := time.Now().UTC()
	if w.Now != nil {
		now = w.Now().UTC()
	}
	tx, err := w.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var event leasedEvent
	err = tx.QueryRow(ctx, `SELECT event_id::text,run_id::text,body,attempts,created_at FROM core_outbox WHERE (status='pending' AND next_attempt_at <= $1) OR (status='leased' AND lease_until <= $1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&event.EventID, &event.RunID, &event.Body, &event.Attempts, &event.CreatedAt)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	lease, e := randomUUID()
	if e != nil {
		return false, e
	}
	event.LeaseToken = lease
	_, err = tx.Exec(ctx, `UPDATE core_outbox SET status='leased',lease_until=$2,lease_token=$3,attempts=attempts+1 WHERE event_id=$1`, event.EventID, now.Add(30*time.Second), lease)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	client := w.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.Endpoint, bytes.NewReader(event.Body))
	if err != nil {
		return true, w.retryWithLog(ctx, event, 0, "request_create_failed", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+w.ServiceToken)
	response, err := client.Do(req)
	if err != nil {
		return true, w.retryWithLog(ctx, event, 0, "transport_failed", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		err = w.finish(ctx, event, true)
		status, reason := "delivered", "accepted"
		if err != nil {
			status, reason = "delivery_state_failed", "delivery_state_update_failed"
		}
		w.logDispatch(event, status, response.StatusCode, reason)
		return true, err
	}
	if response.StatusCode == http.StatusConflict || response.StatusCode == http.StatusBadRequest || response.StatusCode == http.StatusUnprocessableEntity {
		err = w.finish(ctx, event, false)
		status, reason := "rejected", "permanent_rejection"
		if err != nil {
			status, reason = "delivery_state_failed", "delivery_state_update_failed"
		}
		w.logDispatch(event, status, response.StatusCode, reason)
		return true, err
	}
	return true, w.retryWithLog(ctx, event, response.StatusCode, "remote_retryable_status", fmt.Errorf("completion endpoint returned %d", response.StatusCode))
}

func (w *CompletionWorker) retryWithLog(ctx context.Context, event leasedEvent, httpStatus int, reason string, cause error) error {
	err := w.retry(ctx, event, cause)
	status := "pending_retry"
	if err != nil {
		status = "retry_state_failed"
		reason = "retry_state_update_failed"
	}
	w.logDispatch(event, status, httpStatus, reason)
	return err
}

func (w *CompletionWorker) logDispatch(event leasedEvent, status string, httpStatus int, reason string) {
	if w.Logger == nil {
		return
	}
	w.Logger.Info("completion_delivery", "event_id", event.EventID, "run_id", event.RunID, "status", status, "http_status", httpStatus, "attempt", event.Attempts+1, "reason", reason)
}

// completion_delivery_age reports elapsed time since the outbox event was created.
// Only acknowledged deliveries are observed; age is clamped against clock skew.
func (w *CompletionWorker) logDeliveryAge(event leasedEvent, outcome string) {
	if w.Logger == nil || event.CreatedAt.IsZero() {
		return
	}
	now := time.Now().UTC()
	if w.Now != nil {
		now = w.Now().UTC()
	}
	age := max(time.Duration(0), now.Sub(event.CreatedAt))
	w.Logger.Info("completion_delivery_age", "outcome", outcome, "age_ms", age.Milliseconds())
}

// completion_backlog samples pending and leased events at a fixed interval, not per request.
// oldest_age_ms is zero when empty; retrying excludes a leased first attempt.
func (w *CompletionWorker) logBacklog(ctx context.Context) {
	if w.DB == nil || w.Logger == nil {
		return
	}
	var count, retries int64
	var oldest *time.Time
	err := w.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE (status='pending' AND attempts > 0) OR (status='leased' AND attempts > 1)), min(created_at) FROM core_outbox WHERE status IN ('pending','leased')`).Scan(&count, &retries, &oldest)
	if err != nil {
		w.Logger.Warn("completion_backlog_sample_failed", "reason", "query_failed")
		return
	}
	now := time.Now().UTC()
	if w.Now != nil {
		now = w.Now().UTC()
	}
	var age time.Duration
	if oldest != nil {
		age = max(time.Duration(0), now.Sub(*oldest))
	}
	w.Logger.Info("completion_backlog", "pending", count, "retrying", retries, "oldest_age_ms", age.Milliseconds())
}

func (w *CompletionWorker) logWorkerFailure() {
	if w.Logger == nil {
		return
	}
	w.Logger.Warn("completion_dispatch_failed", "status", "retrying", "reason", "dispatch_failed")
}

func (w *CompletionWorker) finish(ctx context.Context, e leasedEvent, accepted bool) error {
	tx, err := w.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	status := "rejected"
	deliveryStatus := "rejected"
	if accepted {
		status = "delivered"
		deliveryStatus = "delivered"
	}
	tag, err := tx.Exec(ctx, `UPDATE core_outbox SET status=$2,lease_until=NULL,lease_token=NULL,delivered_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END,last_error=NULL WHERE event_id=$1 AND status='leased' AND lease_token=$3`, e.EventID, status, e.LeaseToken)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return nil
	}
	tag, err = tx.Exec(ctx, `UPDATE core_runs SET delivery_status=$2 WHERE id=$1 AND verification_status='verified' AND delivery_status='pending'`, e.RunID, deliveryStatus)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("verified run delivery state is no longer pending")
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if accepted {
		w.logDeliveryAge(e, "delivered")
	}
	return nil
}
func (w *CompletionWorker) retry(ctx context.Context, e leasedEvent, cause error) error {
	attempt := e.Attempts + 1
	delay := time.Second << min(attempt, 8)
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	delay += time.Duration(rand.Int63n(max(int64(time.Second), int64(delay)/4)))
	now := time.Now().UTC()
	if w.Now != nil {
		now = w.Now().UTC()
	}
	_, err := w.DB.Exec(ctx, `UPDATE core_outbox SET status='pending',lease_until=NULL,lease_token=NULL,next_attempt_at=$3,last_error=$4 WHERE event_id=$1 AND status='leased' AND lease_token=$2`, e.EventID, e.LeaseToken, now.Add(delay), truncateError(cause.Error(), 200))
	return err
}
func truncateError(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (w *CompletionWorker) RunConcurrent(ctx context.Context, interval time.Duration, workers int) {
	if interval <= 0 {
		interval = time.Second
	}
	if workers < 1 {
		workers = 1
	}
	if workers > 32 {
		workers = 32
	}
	var wg sync.WaitGroup
	if w.DB != nil && w.Logger != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				sampleCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
				w.logBacklog(sampleCtx)
				cancel()
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				sent, err := w.DispatchOne(ctx)
				if err != nil {
					w.logWorkerFailure()
				}
				if err == nil && sent {
					continue
				}
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	}
	wg.Wait()
}

// DecodeEvent is useful to operators inspecting a stored outbox payload without exposing it in service logs.
func DecodeEvent(raw []byte) (map[string]any, error) {
	var event map[string]any
	err := json.Unmarshal(raw, &event)
	return event, err
}
