package core

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	store "doofyduck/core/db"
	sim "doofyduck/simulation"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	DB               *pgxpool.Pool
	Logger           *slog.Logger
	Auth             JWTVerifier
	OperatorToken    string
	OutboxConfigured bool
	MaxInflight      int
	RequestSlots     chan struct{}
	Now              func() time.Time
}

type Snapshot struct {
	RunID              string    `json:"runId"`
	AccountID          string    `json:"accountId"`
	LifeIndex          int       `json:"lifeIndex"`
	Seed               int64     `json:"seed"`
	SimulationVersion  string    `json:"simulationVersion"`
	GeneratorVersion   string    `json:"generatorVersion"`
	ConfigID           string    `json:"configId"`
	State              sim.State `json:"state"`
	Status             string    `json:"status"`
	VerificationStatus string    `json:"verificationStatus"`
	DeliveryStatus     string    `json:"deliveryStatus"`
	CheckpointSequence int64     `json:"checkpointSequence"`
	WriterGeneration   int64     `json:"writerGeneration"`
	ActiveTicks        int64     `json:"activeTicks"`
	ActiveTickLimit    int64     `json:"activeTickLimit"`
	SubmissionDeadline time.Time `json:"submissionDeadline"`
	CompletionReason   string    `json:"completionReason,omitempty"`
	WriterToken        string    `json:"writerToken,omitempty"`
}

type row struct {
	ID, AccountID, Status                                   string
	VerificationStatus, DeliveryStatus                      string
	LifeIndex                                               int
	Seed, CheckpointSequence, WriterGeneration, ActiveTicks int64
	SimVersion, GeneratorVersion, ConfigID                  string
	State                                                   []byte
	WriterTokenHash                                         []byte
	LastContact                                             time.Time
	CompletedAt                                             *time.Time
	CompletionReason                                        *string
}

func (s *Server) Handler() http.Handler {
	if s.MaxInflight < 1 {
		s.MaxInflight = 256
	}
	s.RequestSlots = make(chan struct{}, s.MaxInflight)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /readyz", s.ready)
	mux.Handle("POST /api/v1/runs", s.user(http.HandlerFunc(s.createRun)))
	mux.Handle("GET /api/v1/runs/progress", s.user(http.HandlerFunc(s.getProgress)))
	mux.Handle("GET /api/v1/runs/current", s.user(http.HandlerFunc(s.currentRun)))
	mux.Handle("GET /api/v1/runs/latest", s.user(http.HandlerFunc(s.latestRun)))
	mux.Handle("GET /api/v1/runs/{run_id}", s.user(http.HandlerFunc(s.getRun)))
	mux.Handle("POST /api/v1/runs/{run_id}/checkpoints", s.user(http.HandlerFunc(s.checkpoint)))
	mux.Handle("POST /api/v1/runs/{run_id}/takeover", s.user(http.HandlerFunc(s.takeover)))
	mux.Handle("POST /api/v1/runs/{run_id}/abandon", s.user(http.HandlerFunc(s.abandon)))
	mux.HandleFunc("POST /internal/v1/outages/start", s.operator(s.startOutage))
	mux.HandleFunc("POST /internal/v1/outages/{id}/recover", s.operator(s.recoverOutage))
	return requestLogging(s.Logger)(securityHeaders(mux))
}

type outcomeWriter struct {
	http.ResponseWriter
	status int
}

func (w *outcomeWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *outcomeWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func requestLogging(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if logger == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestID := validRequestID(r.Header.Get("X-Request-ID"))
			if requestID == "" {
				requestID, _ = randomUUID()
			}
			if requestID != "" {
				w.Header().Set("X-Request-ID", requestID)
			}
			started := time.Now()
			outcome := &outcomeWriter{ResponseWriter: w}
			next.ServeHTTP(outcome, r)
			status := outcome.status
			if status == 0 {
				status = http.StatusOK
			}
			route := r.Pattern
			if route == "" {
				route = "unmatched"
			}
			logger.Info("http_request", "request_id", requestID, "method", canonicalMethod(r.Method), "route", route, "status", status, "duration_ms", time.Since(started).Milliseconds())
		})
	}
}

func canonicalMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions:
		return method
	default:
		return "OTHER"
	}
}

func validRequestID(value string) string {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' || strings.ToLower(value) != value {
		return ""
	}
	compact := strings.ReplaceAll(value, "-", "")
	if len(compact) != 32 {
		return ""
	}
	if _, err := hex.DecodeString(compact); err != nil {
		return ""
	}
	return value
}

type claimsKey struct{}

func (s *Server) user(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.DB == nil {
			writeError(w, 503, "not_ready", "database unavailable")
			return
		}
		parts := strings.SplitN(r.Header.Get("Authorization"), " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			writeError(w, 401, "unauthorized", "bearer token required")
			return
		}
		claims, err := s.Auth.Verify(parts[1])
		if err != nil {
			writeError(w, 401, "unauthorized", "invalid bearer token")
			return
		}
		select {
		case s.RequestSlots <- struct{}{}:
			defer func() { <-s.RequestSlots }()
		default:
			w.Header().Set("Retry-After", "1")
			writeError(w, 429, "too_many_requests", "Core is at capacity; retry shortly")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, claimsKey{}, claims)))
	})
}
func (s *Server) operator(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if s.OperatorToken == "" || len(provided) != len(s.OperatorToken) || !constantTimeEqual(provided, s.OperatorToken) {
			writeError(w, 401, "unauthorized", "operator token required")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		next(w, r.WithContext(ctx))
	}
}
func principal(r *http.Request) Claims { c, _ := r.Context().Value(claimsKey{}).(Claims); return c }
func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}
func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	var migrated bool
	if s.DB == nil || s.DB.Ping(ctx) != nil || !s.OutboxConfigured || s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM core_schema_migrations WHERE version >= 1)`).Scan(&migrated) != nil || !migrated {
		writeJSON(w, 503, map[string]string{"status": "not_ready"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ready"})
}

func (s *Server) createRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	account := principal(r).AccountID
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		writeError(w, 503, "database_error", "could not begin run transaction")
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, account); err != nil {
		writeError(w, 503, "database_error", "could not lock account run")
		return
	}
	if current, e := loadCurrentForUpdate(ctx, tx, account); e == nil {
		if current.Status == "completion_pending" {
			writeError(w, 409, "completion_pending", "verified run completion is awaiting account delivery acknowledgement")
			return
		}
		if e = s.expireIfDue(ctx, tx, &current); e != nil {
			writeError(w, 500, "internal", "could not check run deadline")
			return
		}
		if current.Status == "active" {
			snap, e := s.snapshot(ctx, tx, current, "")
			if e != nil {
				writeError(w, 500, "internal", "could not load run")
				return
			}
			_ = tx.Commit(ctx)
			writeJSON(w, 200, snap)
			return
		}
	} else if !errors.Is(e, pgx.ErrNoRows) {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	id, e := randomUUID()
	if e != nil {
		writeError(w, 500, "internal", "could not create run")
		return
	}
	seedBytes := make([]byte, 4)
	if _, e = rand.Read(seedBytes); e != nil {
		writeError(w, 500, "internal", "could not create run")
		return
	}
	seed := int64(uint32(seedBytes[0])<<24 | uint32(seedBytes[1])<<16 | uint32(seedBytes[2])<<8 | uint32(seedBytes[3]))
	config := sim.DefaultConfiguration()
	configID, e := sim.ConfigIDFor(config)
	if e != nil {
		writeError(w, 500, "internal", "simulation configuration invalid")
		return
	}
	state, e := sim.CreateRun(sim.Descriptor{RunID: id, Seed: seed, SimulationVersion: sim.SimulationVersion, GeneratorVersion: sim.GeneratorVersion, ConfigID: configID}, config)
	if e != nil {
		writeError(w, 500, "internal", "could not create simulation")
		return
	}
	raw, e := json.Marshal(state)
	if e != nil {
		writeError(w, 500, "internal", "could not serialize simulation")
		return
	}
	token, e := randomToken()
	if e != nil {
		writeError(w, 500, "internal", "could not create writer")
		return
	}
	hash := sha256.Sum256([]byte(token))
	now := s.now()
	_, e = tx.Exec(ctx, `INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)`, id, account, seed, sim.SimulationVersion, sim.GeneratorVersion, configID, raw, hash[:], now)
	if e != nil {
		writeError(w, 409, "active_run_exists", "an active or pending run already exists")
		return
	}
	if e = tx.Commit(ctx); e != nil {
		writeError(w, 503, "database_error", "could not create run")
		return
	}
	w.Header().Set("Location", "/api/v1/runs/"+id)
	writeJSON(w, 201, Snapshot{RunID: id, AccountID: account, LifeIndex: 0, Seed: seed, SimulationVersion: sim.SimulationVersion, GeneratorVersion: sim.GeneratorVersion, ConfigID: configID, State: state, Status: "active", VerificationStatus: "in_progress", DeliveryStatus: "not_ready", CheckpointSequence: -1, WriterGeneration: 1, ActiveTicks: 0, ActiveTickLimit: ActiveTickLimit, SubmissionDeadline: now.Add(time.Hour), WriterToken: token})
}
func (s *Server) currentRun(w http.ResponseWriter, r *http.Request) {
	account := principal(r).AccountID
	tx, e := s.DB.BeginTx(r.Context(), pgx.TxOptions{})
	if e != nil {
		writeError(w, 503, "database_error", "could not read current run")
		return
	}
	defer tx.Rollback(r.Context())
	run, e := loadCurrentForUpdate(r.Context(), tx, account)
	if errors.Is(e, pgx.ErrNoRows) {
		writeError(w, 404, "not_found", "no active run")
		return
	}
	if e != nil {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	if e = s.expireIfDue(r.Context(), tx, &run); e != nil {
		writeError(w, 500, "internal", "could not check run deadline")
		return
	}
	if run.Status == "rejected" {
		if e = tx.Commit(r.Context()); e != nil {
			writeError(w, 503, "database_error", "could not save expired run")
			return
		}
		writeError(w, 404, "not_found", "no active run")
		return
	}
	snap, e := s.snapshot(r.Context(), tx, run, "")
	if e != nil {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		writeError(w, 503, "database_error", "could not read current run")
		return
	}
	writeJSON(w, 200, snap)
}

func (s *Server) latestRun(w http.ResponseWriter, r *http.Request) {
	run, err := loadLatestRun(r.Context(), s.DB, principal(r).AccountID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "not_found", "no runs found")
		return
	}
	if err != nil {
		writeError(w, 503, "database_error", "could not load latest run")
		return
	}
	snapshot, err := s.snapshot(r.Context(), s.DB, run, "")
	if err != nil {
		writeError(w, 503, "database_error", "could not load latest run")
		return
	}
	writeJSON(w, 200, snapshot)
}

func (s *Server) getProgress(w http.ResponseWriter, r *http.Request) {
	var bestScore int64
	err := s.DB.QueryRow(r.Context(), `SELECT COALESCE((SELECT best_score FROM core_account_progress WHERE account_id=$1),0)`, principal(r).AccountID).Scan(&bestScore)
	if err != nil {
		writeError(w, 503, "database_error", "could not load account progress")
		return
	}
	writeJSON(w, 200, map[string]int64{"bestScore": bestScore})
}
func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
	tx, e := s.DB.BeginTx(r.Context(), pgx.TxOptions{})
	if e != nil {
		writeError(w, 503, "database_error", "could not read run")
		return
	}
	defer tx.Rollback(r.Context())
	run, e := loadRunForUpdate(r.Context(), tx, r.PathValue("run_id"), principal(r).AccountID)
	if errors.Is(e, pgx.ErrNoRows) {
		writeError(w, 404, "not_found", "run not found")
		return
	}
	if e != nil {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	if e = s.expireIfDue(r.Context(), tx, &run); e != nil {
		writeError(w, 500, "internal", "could not check run deadline")
		return
	}
	snap, e := s.snapshot(r.Context(), tx, run, "")
	if e != nil {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		writeError(w, 503, "database_error", "could not read run")
		return
	}
	writeJSON(w, 200, snap)
}
func (s *Server) snapshot(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, run row, token string) (Snapshot, error) {
	var state sim.State
	if e := json.Unmarshal(run.State, &state); e != nil {
		return Snapshot{}, e
	}
	deadline, e := s.deadline(ctx, q, run)
	if e != nil {
		return Snapshot{}, e
	}
	reason := ""
	if run.CompletionReason != nil {
		reason = *run.CompletionReason
	}
	return Snapshot{RunID: run.ID, AccountID: run.AccountID, LifeIndex: run.LifeIndex, Seed: run.Seed, SimulationVersion: run.SimVersion, GeneratorVersion: run.GeneratorVersion, ConfigID: run.ConfigID, State: state, Status: run.Status, VerificationStatus: run.VerificationStatus, DeliveryStatus: run.DeliveryStatus, CheckpointSequence: run.CheckpointSequence, WriterGeneration: run.WriterGeneration, ActiveTicks: run.ActiveTicks, ActiveTickLimit: ActiveTickLimit, SubmissionDeadline: deadline, CompletionReason: reason, WriterToken: token}, nil
}
func (s *Server) deadline(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, run row) (time.Time, error) {
	var deadline time.Time
	err := q.QueryRow(ctx, `WITH RECURSIVE extension(deadline, depth) AS (
 SELECT $1::timestamptz, 0
 UNION ALL
 SELECT outage.recovered + interval '1 hour', extension.depth + 1
 FROM extension
 CROSS JOIN LATERAL (
   SELECT max(COALESCE(recovered_at, $2::timestamptz)) AS recovered
   FROM core_outages
   WHERE started_at <= extension.deadline
     AND COALESCE(recovered_at, $2::timestamptz) >= $3
 ) AS outage
 WHERE outage.recovered + interval '1 hour' > extension.deadline
)
SELECT max(deadline) FROM extension`, run.LastContact.Add(time.Hour), s.now(), run.LastContact).Scan(&deadline)
	return deadline, err
}

func (s *Server) expireIfDue(ctx context.Context, tx pgx.Tx, run *row) error {
	if run.Status != "active" {
		return nil
	}
	deadline, err := s.deadline(ctx, tx, *run)
	if err != nil {
		return err
	}
	if s.now().After(deadline) {
		if _, err = tx.Exec(ctx, `UPDATE core_runs SET status='rejected',verification_status='rejected' WHERE id=$1 AND status='active'`, run.ID); err != nil {
			return err
		}
		run.Status = "rejected"
	}
	return nil
}

func (s *Server) checkpoint(w http.ResponseWriter, r *http.Request) {
	var req checkpointRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.CheckpointSequence < 0 || req.WriterGeneration < 1 || len(req.IdempotencyKey) < 8 || len(req.IdempotencyKey) > 128 || len(req.Ticks) < 1 || len(req.Ticks) > CheckpointTickLimit {
		writeError(w, 400, "invalid_checkpoint", "invalid checkpoint fields or size")
		return
	}
	encoded, e := json.Marshal(req)
	if e != nil {
		writeError(w, 400, "invalid_checkpoint", "invalid checkpoint")
		return
	}
	digest := sha256.Sum256(encoded)
	evidence, e := json.Marshal(checkpointEvidence{Version: 1, CheckpointSequence: req.CheckpointSequence, WriterGeneration: req.WriterGeneration, IdempotencyKey: req.IdempotencyKey, Ticks: req.Ticks})
	if e != nil {
		writeError(w, 400, "invalid_checkpoint", "invalid checkpoint evidence")
		return
	}
	ctx := r.Context()
	tx, e := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if e != nil {
		writeError(w, 503, "database_error", "could not begin checkpoint")
		return
	}
	defer tx.Rollback(ctx)
	run, e := loadRunForUpdate(ctx, tx, r.PathValue("run_id"), principal(r).AccountID)
	if errors.Is(e, pgx.ErrNoRows) {
		writeError(w, 404, "not_found", "run not found")
		return
	}
	if e != nil {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	if req.WriterGeneration != run.WriterGeneration || !checkWriterToken(req.WriterToken, run) {
		writeError(w, 409, "writer_fenced", "writer generation or token is stale")
		return
	}
	if e = s.expireIfDue(ctx, tx, &run); e != nil {
		writeError(w, 500, "internal", "could not check run deadline")
		return
	}
	if run.Status == "rejected" {
		if e = tx.Commit(ctx); e != nil {
			writeError(w, 503, "database_error", "could not save expired run")
			return
		}
		writeError(w, 410, "submission_expired", "run submission window expired")
		return
	}
	var oldHash, oldResponse []byte
	e = tx.QueryRow(ctx, `SELECT request_hash,response FROM core_checkpoints WHERE run_id=$1 AND (checkpoint_sequence=$2 OR idempotency_key=$3)`, run.ID, req.CheckpointSequence, req.IdempotencyKey).Scan(&oldHash, &oldResponse)
	if e == nil {
		if string(oldHash) == string(digest[:]) {
			var response Snapshot
			if json.Unmarshal(oldResponse, &response) == nil {
				_ = tx.Commit(ctx)
				writeJSON(w, 200, response)
				return
			}
		}
		writeError(w, 409, "idempotency_conflict", "checkpoint sequence or key was already used with different contents")
		return
	} else if !errors.Is(e, pgx.ErrNoRows) {
		writeError(w, 500, "internal", "could not inspect checkpoint replay")
		return
	}
	if run.Status != "active" {
		writeError(w, 409, "run_not_active", "run is not accepting checkpoints")
		return
	}
	if req.CheckpointSequence != run.CheckpointSequence+1 {
		writeError(w, 409, "checkpoint_gap", "checkpoint sequence is not next")
		return
	}
	var state sim.State
	if e = json.Unmarshal(run.State, &state); e != nil {
		writeError(w, 500, "internal", "stored simulation state is invalid")
		return
	}
	state, activeTicks, reason, e := ReplayCheckpoint(state, run.ActiveTicks, req.Ticks, ActiveTickLimit)
	if e != nil {
		writeError(w, 400, "invalid_replay", "simulation rejected checkpoint")
		return
	}
	stateBytes, e := json.Marshal(state)
	if e != nil {
		writeError(w, 500, "internal", "could not store simulation state")
		return
	}
	status := "active"
	verificationStatus, deliveryStatus := "in_progress", "not_ready"
	var completed any
	var reasonValue any
	if reason != "" {
		status = "completion_pending"
		verificationStatus, deliveryStatus = "verified", "pending"
		completed = s.now()
		reasonValue = reason
	}
	_, e = tx.Exec(ctx, `UPDATE core_runs SET state=$2,status=$3,verification_status=$4,delivery_status=$5,checkpoint_sequence=$6,active_ticks=$7,last_contact=$8,completed_at=$9,completion_reason=$10 WHERE id=$1`, run.ID, stateBytes, status, verificationStatus, deliveryStatus, req.CheckpointSequence, activeTicks, s.now(), completed, reasonValue)
	if e != nil {
		writeError(w, 500, "internal", "could not persist checkpoint")
		return
	}
	var eventID string
	if reason != "" {
		eventID, e = randomUUID()
		if e != nil {
			writeError(w, 500, "internal", "could not create completion event")
			return
		}
		if _, e = tx.Exec(ctx, `INSERT INTO core_account_progress(account_id,best_score) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET best_score=GREATEST(core_account_progress.best_score,EXCLUDED.best_score),updated_at=now()`, run.AccountID, state.Score); e != nil {
			writeError(w, 500, "internal", "could not update account progress")
			return
		}
		collections := map[string]int64{"FEATHER": state.Totals["FEATHER"], "GAME_STAR": state.Totals["GAME_STAR"]}
		body := map[string]any{"event_id": eventID, "type": "RunLifeCompleted.v1", "account_id": run.AccountID, "run_id": run.ID, "life_index": run.LifeIndex, "simulation_version": run.SimVersion, "generator_version": run.GeneratorVersion, "config_id": run.ConfigID, "checkpoint_sequence": req.CheckpointSequence, "score": state.Score, "collections": collections, "reason": reason, "completed_at": s.now().Format(time.RFC3339Nano)}
		bodyJSON, _ := json.Marshal(body)
		_, e = tx.Exec(ctx, `INSERT INTO core_outbox(event_id,run_id,body,next_attempt_at) VALUES($1,$2,$3,$4)`, eventID, run.ID, bodyJSON, s.now())
		if e != nil {
			writeError(w, 500, "internal", "could not queue completion")
			return
		}
		_, e = tx.Exec(ctx, `UPDATE core_runs SET completion_event_id=$2 WHERE id=$1`, run.ID, eventID)
		if e != nil {
			writeError(w, 500, "internal", "could not attach completion event")
			return
		}
	}
	run.State = stateBytes
	run.Status = status
	run.VerificationStatus = verificationStatus
	run.DeliveryStatus = deliveryStatus
	run.CheckpointSequence = req.CheckpointSequence
	run.ActiveTicks = activeTicks
	run.LastContact = s.now()
	run.CompletionReason = nil
	if reason != "" {
		run.CompletionReason = &reason
	}
	snap, e := s.snapshot(ctx, tx, run, "")
	if e != nil {
		writeError(w, 500, "internal", "could not create checkpoint response")
		return
	}
	responseBytes, _ := json.Marshal(snap)
	_, e = tx.Exec(ctx, `INSERT INTO core_checkpoints(run_id,checkpoint_sequence,idempotency_key,request_hash,input_batch,response) VALUES($1,$2,$3,$4,$5,$6)`, run.ID, req.CheckpointSequence, req.IdempotencyKey, digest[:], evidence, responseBytes)
	if e != nil {
		writeError(w, 409, "checkpoint_conflict", "checkpoint already exists")
		return
	}
	if e = tx.Commit(ctx); e != nil {
		writeError(w, 503, "database_error", "could not persist checkpoint")
		return
	}
	writeJSON(w, 200, snap)
}

type checkpointRequest struct {
	CheckpointSequence int64         `json:"checkpointSequence"`
	WriterGeneration   int64         `json:"writerGeneration"`
	WriterToken        string        `json:"writerToken"`
	IdempotencyKey     string        `json:"idempotencyKey"`
	Ticks              [][]sim.Input `json:"ticks"`
}

type checkpointEvidence struct {
	Version            int           `json:"version"`
	CheckpointSequence int64         `json:"checkpointSequence"`
	WriterGeneration   int64         `json:"writerGeneration"`
	IdempotencyKey     string        `json:"idempotencyKey"`
	Ticks              [][]sim.Input `json:"ticks"`
}

func (s *Server) takeover(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("run_id")
	account := principal(r).AccountID
	token, e := randomToken()
	if e != nil {
		writeError(w, 500, "internal", "could not rotate writer")
		return
	}
	hash := sha256.Sum256([]byte(token))
	tx, e := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if e != nil {
		writeError(w, 503, "database_error", "could not begin takeover")
		return
	}
	defer tx.Rollback(ctx)
	run, e := loadRunForUpdate(ctx, tx, id, account)
	if errors.Is(e, pgx.ErrNoRows) {
		writeError(w, 404, "not_found", "run not found")
		return
	}
	if e != nil {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	if run.Status != "active" {
		writeError(w, 409, "run_not_active", "run is not active")
		return
	}
	run.WriterGeneration++
	_, e = tx.Exec(ctx, `UPDATE core_runs SET writer_generation=$2,writer_token_hash=$3 WHERE id=$1`, run.ID, run.WriterGeneration, hash[:])
	if e != nil {
		writeError(w, 500, "internal", "could not rotate writer")
		return
	}
	snap, e := s.snapshot(ctx, tx, run, token)
	if e != nil {
		writeError(w, 500, "internal", "could not create snapshot")
		return
	}
	if e = tx.Commit(ctx); e != nil {
		writeError(w, 503, "database_error", "could not complete takeover")
		return
	}
	writeJSON(w, 200, snap)
}
func (s *Server) abandon(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WriterGeneration int64  `json:"writerGeneration"`
		WriterToken      string `json:"writerToken"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	ctx := r.Context()
	tx, e := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if e != nil {
		writeError(w, 503, "database_error", "could not begin abandonment")
		return
	}
	defer tx.Rollback(ctx)
	run, e := loadRunForUpdate(ctx, tx, r.PathValue("run_id"), principal(r).AccountID)
	if errors.Is(e, pgx.ErrNoRows) {
		writeError(w, 404, "not_found", "run not found")
		return
	}
	if e != nil {
		writeError(w, 500, "internal", "could not load run")
		return
	}
	if run.Status != "active" || req.WriterGeneration != run.WriterGeneration || !checkWriterToken(req.WriterToken, run) {
		writeError(w, 409, "writer_fenced", "writer is stale or run is not active")
		return
	}
	run.Status = "abandoned"
	run.VerificationStatus = "rejected"
	_, e = tx.Exec(ctx, `UPDATE core_runs SET status='abandoned',verification_status='rejected' WHERE id=$1`, run.ID)
	if e != nil {
		writeError(w, 500, "internal", "could not abandon run")
		return
	}
	snap, e := s.snapshot(ctx, tx, run, "")
	if e != nil {
		writeError(w, 500, "internal", "could not create snapshot")
		return
	}
	if e = tx.Commit(ctx); e != nil {
		writeError(w, 503, "database_error", "could not abandon run")
		return
	}
	writeJSON(w, 200, snap)
}

func (s *Server) startOutage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		StartedAt time.Time `json:"startedAt"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.StartedAt.IsZero() || req.StartedAt.After(s.now()) {
		writeError(w, 400, "invalid_outage", "startedAt must be in the past")
		return
	}
	id, e := randomUUID()
	if e != nil {
		writeError(w, 500, "internal", "could not record outage")
		return
	}
	_, e = s.DB.Exec(r.Context(), `INSERT INTO core_outages(id,started_at) VALUES($1,$2)`, id, req.StartedAt.UTC())
	if e != nil {
		writeError(w, 500, "internal", "could not record outage")
		return
	}
	writeJSON(w, 201, map[string]any{"id": id, "startedAt": req.StartedAt.UTC()})
}
func (s *Server) recoverOutage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RecoveredAt time.Time `json:"recoveredAt"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.RecoveredAt.IsZero() || req.RecoveredAt.After(s.now()) {
		writeError(w, 400, "invalid_outage", "recoveredAt must be in the past")
		return
	}
	tag, e := s.DB.Exec(r.Context(), `UPDATE core_outages SET recovered_at=$2 WHERE id=$1 AND recovered_at IS NULL`, r.PathValue("id"), req.RecoveredAt.UTC())
	if e != nil || tag.RowsAffected() != 1 {
		writeError(w, 404, "not_found", "open outage not found")
		return
	}
	writeJSON(w, 200, map[string]any{"id": r.PathValue("id"), "recoveredAt": req.RecoveredAt.UTC()})
}

func loadLatestRun(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, account string) (row, error) {
	return scanRun(q.QueryRow(ctx, `SELECT id::text,account_id::text,status,verification_status,delivery_status,life_index,seed,simulation_version,generator_version,config_id,state,writer_token_hash,checkpoint_sequence,writer_generation,active_ticks,last_contact,completed_at,completion_reason FROM core_runs WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, account))
}
func loadCurrent(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, account string) (row, error) {
	return scanRun(q.QueryRow(ctx, `SELECT id::text,account_id::text,status,verification_status,delivery_status,life_index,seed,simulation_version,generator_version,config_id,state,writer_token_hash,checkpoint_sequence,writer_generation,active_ticks,last_contact,completed_at,completion_reason FROM core_runs WHERE account_id=$1 AND status IN ('active','completion_pending') ORDER BY created_at DESC LIMIT 1`, account))
}
func loadCurrentForUpdate(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, account string) (row, error) {
	return scanRun(q.QueryRow(ctx, `SELECT id::text,account_id::text,status,verification_status,delivery_status,life_index,seed,simulation_version,generator_version,config_id,state,writer_token_hash,checkpoint_sequence,writer_generation,active_ticks,last_contact,completed_at,completion_reason FROM core_runs WHERE account_id=$1 AND status IN ('active','completion_pending') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, account))
}
func loadRun(ctx context.Context, q interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}, id, account string) (row, error) {
	idValue, err := uuidValue(id)
	if err != nil {
		return row{}, pgx.ErrNoRows
	}
	accountValue, err := uuidValue(account)
	if err != nil {
		return row{}, pgx.ErrNoRows
	}
	result, err := store.New(q).GetRunForAccount(ctx, store.GetRunForAccountParams{ID: idValue, AccountID: accountValue})
	if err != nil {
		return row{}, err
	}
	out := row{ID: result.ID, AccountID: result.AccountID, Status: result.Status, VerificationStatus: result.VerificationStatus, DeliveryStatus: result.DeliveryStatus, LifeIndex: int(result.LifeIndex), Seed: result.Seed, SimVersion: result.SimulationVersion, GeneratorVersion: result.GeneratorVersion, ConfigID: result.ConfigID, State: []byte(result.State), WriterTokenHash: result.WriterTokenHash, CheckpointSequence: result.CheckpointSequence, WriterGeneration: result.WriterGeneration, ActiveTicks: result.ActiveTicks, LastContact: result.LastContact.Time}
	if result.CompletedAt.Valid {
		value := result.CompletedAt.Time
		out.CompletedAt = &value
	}
	if result.CompletionReason.Valid {
		value := result.CompletionReason.String
		out.CompletionReason = &value
	}
	return out, nil
}
func loadRunForUpdate(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id, account string) (row, error) {
	if _, err := uuidValue(id); err != nil {
		return row{}, pgx.ErrNoRows
	}
	return scanRun(q.QueryRow(ctx, `SELECT id::text,account_id::text,status,verification_status,delivery_status,life_index,seed,simulation_version,generator_version,config_id,state,writer_token_hash,checkpoint_sequence,writer_generation,active_ticks,last_contact,completed_at,completion_reason FROM core_runs WHERE id=$1 AND account_id=$2 FOR UPDATE`, id, account))
}
func scanRun(q pgx.Row) (x row, err error) {
	err = q.Scan(&x.ID, &x.AccountID, &x.Status, &x.VerificationStatus, &x.DeliveryStatus, &x.LifeIndex, &x.Seed, &x.SimVersion, &x.GeneratorVersion, &x.ConfigID, &x.State, &x.WriterTokenHash, &x.CheckpointSequence, &x.WriterGeneration, &x.ActiveTicks, &x.LastContact, &x.CompletedAt, &x.CompletionReason)
	return
}

func uuidValue(value string) (pgtype.UUID, error) {
	compact := strings.ReplaceAll(value, "-", "")
	if len(compact) != 32 {
		return pgtype.UUID{}, errors.New("invalid UUID")
	}
	decoded, err := hex.DecodeString(compact)
	if err != nil {
		return pgtype.UUID{}, err
	}
	var id pgtype.UUID
	copy(id.Bytes[:], decoded)
	id.Valid = true
	return id, nil
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			writeError(w, 413, "payload_too_large", "request body exceeds limit")
			return false
		}
		writeError(w, 400, "invalid_json", "request body is invalid")
		return false
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		writeError(w, 400, "invalid_json", "request body must contain one JSON value")
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func randomUUID() (string, error) {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s", hex.EncodeToString(b[:4]), hex.EncodeToString(b[4:6]), hex.EncodeToString(b[6:8]), hex.EncodeToString(b[8:10]), hex.EncodeToString(b[10:])), nil
}
func checkWriterToken(token string, run row) bool {
	if token == "" {
		return false
	}
	hash := sha256.Sum256([]byte(token))
	var stored []byte
	if len(run.WriterTokenHash) > 0 {
		stored = run.WriterTokenHash
	}
	return len(stored) == sha256.Size && constantTimeEqual(string(hash[:]), string(stored))
}
func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := range a {
		v |= a[i] ^ b[i]
	}
	return v == 0
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
