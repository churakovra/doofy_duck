package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CompletionWorker struct {
	DB           *pgxpool.Pool
	Client       *http.Client
	Endpoint     string
	ServiceToken string
	Now          func() time.Time
}

type leasedEvent struct {
	EventID, RunID, LeaseToken string
	Body                       []byte
	Attempts                   int
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
	err = tx.QueryRow(ctx, `SELECT event_id::text,run_id::text,body,attempts FROM core_outbox WHERE (status='pending' AND next_attempt_at <= $1) OR (status='leased' AND lease_until <= $1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&event.EventID, &event.RunID, &event.Body, &event.Attempts)
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
		return true, w.retry(ctx, event, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+w.ServiceToken)
	response, err := client.Do(req)
	if err != nil {
		return true, w.retry(ctx, event, err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return true, w.finish(ctx, event, true)
	}
	if response.StatusCode == http.StatusConflict || response.StatusCode == http.StatusBadRequest || response.StatusCode == http.StatusUnprocessableEntity {
		return true, w.finish(ctx, event, false)
	}
	return true, w.retry(ctx, event, fmt.Errorf("completion endpoint returned %d", response.StatusCode))
}

func (w *CompletionWorker) finish(ctx context.Context, e leasedEvent, accepted bool) error {
	tx, err := w.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	status := "rejected"
	runStatus := "rejected"
	deliveryStatus := "rejected"
	if accepted {
		status = "delivered"
		runStatus = "completed"
		deliveryStatus = "delivered"
	}
	tag, err := tx.Exec(ctx, `UPDATE core_outbox SET status=$2,lease_until=NULL,lease_token=NULL,delivered_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END,last_error=NULL WHERE event_id=$1 AND status='leased' AND lease_token=$3`, e.EventID, status, e.LeaseToken)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return nil
	}
	if _, err = tx.Exec(ctx, `UPDATE core_runs SET status=$2,delivery_status=$3 WHERE id=$1 AND status='completion_pending'`, e.RunID, runStatus, deliveryStatus); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				sent, err := w.DispatchOne(ctx)
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
