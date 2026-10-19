package core

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"doofyduck/core/migrations"
	sim "doofyduck/simulation"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresRunCheckpointsAreOwnedIdempotentAndFenced(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	pub, priv, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	server := &Server{DB: pool, Auth: JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}}, OutboxConfigured: true}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	token := integrationToken(t, priv)
	create := func(auth string) (Snapshot, int) {
		resp := request(t, httpServer.Client(), http.MethodPost, httpServer.URL+"/api/v1/runs", auth, nil)
		defer resp.Body.Close()
		var snapshot Snapshot
		_ = json.NewDecoder(resp.Body).Decode(&snapshot)
		return snapshot, resp.StatusCode
	}
	// Race two truly new run requests for an account with no existing record.
	otherToken := integrationTokenFor(t, priv, "00000000-0000-4000-8000-000000000002")
	results := make(chan struct {
		snapshot Snapshot
		status   int
	}, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			snap, code := create(otherToken)
			results <- struct {
				snapshot Snapshot
				status   int
			}{snap, code}
		}()
	}
	wg.Wait()
	close(results)
	var raceRun Snapshot
	created, recovered := 0, 0
	for result := range results {
		if result.status == 201 {
			created++
			raceRun = result.snapshot
		} else if result.status == 200 {
			recovered++
			if raceRun.RunID == "" {
				raceRun = result.snapshot
			}
		} else {
			t.Fatalf("initial create race status=%d", result.status)
		}
	}
	if created != 1 || recovered != 1 {
		t.Fatalf("initial create race: created=%d recovered=%d", created, recovered)
	}
	var accountRuns int
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM core_runs WHERE account_id=$1`, "00000000-0000-4000-8000-000000000002").Scan(&accountRuns); e != nil || accountRuns != 1 {
		t.Fatalf("initial create race rows=%d err=%v", accountRuns, e)
	}

	first, status := create(token)
	if status != 201 {
		t.Fatalf("create status %d", status)
	}
	if first.WriterToken == "" {
		t.Fatal("new run did not return writer token")
	}
	if first.SimulationVersion != sim.SimulationVersion || first.GeneratorVersion != sim.GeneratorVersion ||
		first.ConfigID != sim.DefaultConfigID || first.State.Config.Wetland == nil || first.State.Config.Wetland.CatalogVersion != 3 {
		t.Fatalf("new run identity/catalog mismatch: %s/%s/%s", first.SimulationVersion, first.GeneratorVersion, first.ConfigID)
	}
	statuses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, code := create(token); statuses <- code }()
	}
	wg.Wait()
	close(statuses)
	for code := range statuses {
		if code != 200 {
			t.Fatalf("concurrent recovery status=%d", code)
		}
	}
	checkpoint := map[string]any{"checkpointSequence": 0, "writerGeneration": 1, "writerToken": first.WriterToken, "idempotencyKey": "first-checkpoint", "ticks": [][]sim.Input{{{Sequence: 0, Action: "FLAP"}}, {}}}
	resp := request(t, httpServer.Client(), http.MethodPost, httpServer.URL+"/api/v1/runs/"+first.RunID+"/checkpoints", token, checkpoint)
	if resp.StatusCode != 200 {
		t.Fatalf("checkpoint status %d", resp.StatusCode)
	}
	var ack Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&ack)
	resp.Body.Close()
	if ack.ActiveTicks != 2 || ack.CheckpointSequence != 0 || ack.WriterToken != "" ||
		ack.SimulationVersion != sim.SimulationVersion || ack.GeneratorVersion != sim.GeneratorVersion || ack.ConfigID != sim.DefaultConfigID ||
		ack.State.Descriptor.SimulationVersion != sim.SimulationVersion || ack.State.Config.Wetland == nil || ack.State.Config.Wetland.CatalogVersion != 3 {
		t.Fatalf("bad checkpoint snapshot: %+v", ack)
	}
	resp = request(t, httpServer.Client(), http.MethodGet, httpServer.URL+"/api/v1/runs/current", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("recovered checkpoint run status %d", resp.StatusCode)
	}
	var recoveredRun Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&recoveredRun)
	resp.Body.Close()
	if recoveredRun.RunID != first.RunID || recoveredRun.SimulationVersion != sim.SimulationVersion || recoveredRun.GeneratorVersion != sim.GeneratorVersion ||
		recoveredRun.ConfigID != sim.DefaultConfigID || recoveredRun.State.Descriptor.ConfigID != sim.DefaultConfigID || recoveredRun.State.Config.Wetland == nil || recoveredRun.State.Config.Wetland.CatalogVersion != 3 {
		t.Fatalf("checkpoint recovery changed paired identity: %+v", recoveredRun)
	}
	resp = request(t, httpServer.Client(), http.MethodPost, httpServer.URL+"/api/v1/runs/"+first.RunID+"/checkpoints", token, checkpoint)
	if resp.StatusCode != 200 {
		t.Fatalf("identical retry status %d", resp.StatusCode)
	}
	resp.Body.Close()
	var evidenceBytes []byte
	if e = pool.QueryRow(ctx, `SELECT input_batch FROM core_checkpoints WHERE run_id=$1 AND checkpoint_sequence=0`, first.RunID).Scan(&evidenceBytes); e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(evidenceBytes, []byte(first.WriterToken)) {
		t.Fatal("stored checkpoint evidence contains the writer token")
	}
	var evidence checkpointEvidence
	if e = json.Unmarshal(evidenceBytes, &evidence); e != nil || evidence.Version != 1 || evidence.CheckpointSequence != 0 || len(evidence.Ticks) != 2 {
		t.Fatalf("invalid checkpoint evidence: %+v err=%v", evidence, e)
	}
	replayed, replayTicks, _, e := ReplayCheckpoint(first.State, 0, evidence.Ticks, ActiveTickLimit)
	replayedJSON, replayJSONErr := sim.CanonicalJSON(replayed)
	ackJSON, ackJSONErr := sim.CanonicalJSON(ack.State)
	if e != nil || replayJSONErr != nil || ackJSONErr != nil || replayTicks != ack.ActiveTicks || replayedJSON != ackJSON {
		t.Fatalf("stored input evidence did not reproduce accepted state: ticks=%d err=%v", replayTicks, e)
	}
	conflict := map[string]any{"checkpointSequence": 0, "writerGeneration": 1, "writerToken": first.WriterToken, "idempotencyKey": "different-key", "ticks": [][]sim.Input{{{Sequence: 0, Action: "FLAP"}}, {}}}
	resp = request(t, httpServer.Client(), http.MethodPost, httpServer.URL+"/api/v1/runs/"+first.RunID+"/checkpoints", token, conflict)
	if resp.StatusCode != 409 {
		t.Fatalf("conflicting retry status %d", resp.StatusCode)
	}
	resp.Body.Close()
	gap := map[string]any{"checkpointSequence": 2, "writerGeneration": 1, "writerToken": first.WriterToken, "idempotencyKey": "gap-checkpoint", "ticks": [][]sim.Input{{}}}
	resp = request(t, httpServer.Client(), http.MethodPost, httpServer.URL+"/api/v1/runs/"+first.RunID+"/checkpoints", token, gap)
	if resp.StatusCode != 409 {
		t.Fatalf("gap status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = request(t, httpServer.Client(), http.MethodPost, httpServer.URL+"/api/v1/runs/"+first.RunID+"/takeover", token, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("takeover status %d", resp.StatusCode)
	}
	var takeover Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&takeover)
	resp.Body.Close()
	if takeover.WriterGeneration != 2 || takeover.WriterToken == "" {
		t.Fatalf("takeover failed: %+v", takeover)
	}
	checkpoint["checkpointSequence"] = 1
	checkpoint["idempotencyKey"] = "stale-writer"
	resp = request(t, httpServer.Client(), http.MethodPost, httpServer.URL+"/api/v1/runs/"+first.RunID+"/checkpoints", token, checkpoint)
	if resp.StatusCode != 409 {
		t.Fatalf("stale writer status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = request(t, httpServer.Client(), http.MethodGet, httpServer.URL+"/api/v1/runs/"+first.RunID, integrationTokenFor(t, priv, "00000000-0000-4000-8000-000000000003"), nil)
	if resp.StatusCode != 404 {
		t.Fatalf("foreign owner status %d", resp.StatusCode)
	}
	resp.Body.Close()
	var checkpointCount int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM core_checkpoints WHERE run_id=$1`, first.RunID).Scan(&checkpointCount); e != nil || checkpointCount != 1 {
		t.Fatalf("checkpoint records=%d err=%v", checkpointCount, e)
	}
}

func TestPostgresRecoveryRetainsPersistedCatalogTwoIdentity(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	const runID = "00000000-0000-4000-8000-000000000289"
	const accountID = "00000000-0000-4000-8000-000000000290"
	config := sim.VariedObstacleConfiguration()
	configID, err := sim.ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := sim.CreateRun(sim.Descriptor{RunID: runID, Seed: 37, SimulationVersion: sim.VariedObstacleSimulationVersion, GeneratorVersion: sim.VariedObstacleGeneratorVersion, ConfigID: configID}, config)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact) VALUES($1,$2,37,$3,$4,$5,$6,'active',decode('01','hex'),now())`, runID, accountID, sim.VariedObstacleSimulationVersion, sim.VariedObstacleGeneratorVersion, configID, encoded); err != nil {
		t.Fatal(err)
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer((&Server{DB: pool, Auth: JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}}, OutboxConfigured: true}).Handler())
	defer server.Close()
	resp := request(t, server.Client(), http.MethodGet, server.URL+"/api/v1/runs/current", integrationTokenFor(t, priv, accountID), nil)
	defer resp.Body.Close()
	var recovered Snapshot
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&recovered) != nil {
		t.Fatalf("persisted catalog-2 run recovery status=%d", resp.StatusCode)
	}
	if recovered.RunID != runID || recovered.SimulationVersion != sim.VariedObstacleSimulationVersion || recovered.GeneratorVersion != sim.VariedObstacleGeneratorVersion ||
		recovered.ConfigID != sim.VariedObstacleDefaultConfigID || recovered.State.Config.Wetland == nil || recovered.State.Config.Wetland.CatalogVersion != 2 {
		t.Fatalf("catalog-2 recovery identity changed: %+v", recovered)
	}
}

func TestReadyRequiresEveryEmbeddedMigration(t *testing.T) {
	pool := testPool(t)
	server := httptest.NewServer((&Server{DB: pool, OutboxConfigured: true}).Handler())
	defer server.Close()
	if _, err := pool.Exec(context.Background(), `DELETE FROM core_schema_migrations WHERE version=4`); err != nil {
		t.Fatal(err)
	}
	requestReady := func() int {
		resp, err := server.Client().Get(server.URL + "/readyz")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if status := requestReady(); status != http.StatusServiceUnavailable {
		t.Fatalf("incomplete migration set readiness status=%d", status)
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO core_schema_migrations(version,name) VALUES(4,'004_verified_completion_delivery_lifecycle.sql')`); err != nil {
		t.Fatal(err)
	}
	if status := requestReady(); status != http.StatusOK {
		t.Fatalf("fully migrated readiness status=%d", status)
	}
	if _, err := pool.Exec(context.Background(), `DELETE FROM core_schema_migrations WHERE version=4`); err != nil {
		t.Fatal(err)
	}
	if status := requestReady(); status != http.StatusServiceUnavailable {
		t.Fatalf("missing current migration readiness status=%d", status)
	}
}

func TestPostgresRecoveryRetainsPersistedCatalogOneIdentity(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	const runID = "00000000-0000-4000-8000-000000000287"
	const accountID = "00000000-0000-4000-8000-000000000288"
	config := sim.WetlandConfiguration()
	configID, err := sim.ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := sim.CreateRun(sim.Descriptor{RunID: runID, Seed: 37, SimulationVersion: sim.WetlandSimulationVersion, GeneratorVersion: sim.WetlandGeneratorVersion, ConfigID: configID}, config)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact) VALUES($1,$2,37,$3,$4,$5,$6,'active',decode('01','hex'),now())`, runID, accountID, sim.WetlandSimulationVersion, sim.WetlandGeneratorVersion, configID, encoded); err != nil {
		t.Fatal(err)
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer((&Server{DB: pool, Auth: JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}}, OutboxConfigured: true}).Handler())
	defer server.Close()
	resp := request(t, server.Client(), http.MethodGet, server.URL+"/api/v1/runs/current", integrationTokenFor(t, priv, accountID), nil)
	defer resp.Body.Close()
	var recovered Snapshot
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&recovered) != nil {
		t.Fatalf("persisted catalog-1 run recovery status=%d", resp.StatusCode)
	}
	if recovered.RunID != runID || recovered.SimulationVersion != sim.WetlandSimulationVersion || recovered.GeneratorVersion != sim.WetlandGeneratorVersion ||
		recovered.ConfigID != "dd-v2-wetland-v1" || recovered.State.Config.Wetland == nil || recovered.State.Config.Wetland.CatalogVersion != 1 {
		t.Fatalf("catalog-1 recovery identity changed: %+v", recovered)
	}
}

func request(t *testing.T, client *http.Client, method, url, token string, body any) *http.Response {
	t.Helper()
	var encoded []byte
	if body != nil {
		encoded, _ = json.Marshal(body)
	}
	req, e := http.NewRequest(method, url, bytes.NewReader(encoded))
	if e != nil {
		t.Fatal(e)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	return resp
}
func integrationToken(t *testing.T, key ed25519.PrivateKey) string {
	return integrationTokenFor(t, key, "00000000-0000-4000-8000-000000000001")
}
func integrationTokenFor(t *testing.T, key ed25519.PrivateKey, account string) string {
	return integrationTokenAt(t, key, account, time.Now())
}
func integrationTokenAt(t *testing.T, key ed25519.PrivateKey, account string, at time.Time) string {
	t.Helper()
	now := at.Unix()
	head, _ := json.Marshal(map[string]string{"alg": "EdDSA", "kid": "k"})
	claims, _ := json.Marshal(map[string]any{"iss": "doofy-platform", "aud": "doofy-core", "sub": account, "iat": now, "exp": now + 300, "jti": "00000000-0000-4000-8000-000000000009", "scope": []string{"run:write"}})
	input := base64Raw(head) + "." + base64Raw(claims)
	return input + "." + base64Raw(ed25519.Sign(key, []byte(input)))
}
func base64Raw(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("CORE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("CORE_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := "core_test_" + strings.ReplaceAll(strings.ToLower(t.Name()), "/", "_") + "_" + strings.ReplaceAll(time.Now().Format("20060102150405.000000000"), ".", "")
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(ctx, `DROP SCHEMA `+pgx.Identifier{schema}.Sanitize()+` CASCADE`)
		admin.Close()
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close() })
	if err = migrations.ApplyThrough(ctx, pool, 1); err != nil {
		t.Fatal(err)
	}
	// Emulate the intermediate v1 schema that was deployed before lifecycle
	// status names changed, including its check constraint and partial index.
	if _, err = pool.Exec(ctx, `ALTER TABLE core_runs DROP CONSTRAINT core_runs_status_check; ALTER TABLE core_runs ADD CONSTRAINT core_runs_status_check CHECK (status IN ('active','pending_verification','verified','rejected','abandoned')); DROP INDEX core_one_active_run_per_account; CREATE UNIQUE INDEX core_one_active_run_per_account ON core_runs(account_id) WHERE status IN ('active','pending_verification')`); err != nil {
		t.Fatal(err)
	}
	legacyRunID := "00000000-0000-4000-8000-000000000099"
	if _, err = pool.Exec(ctx, `INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact) VALUES($1,$2,1,'legacy-sim','legacy-gen','legacy-config','{}','verified',decode('00','hex'),now())`, legacyRunID, "00000000-0000-4000-8000-000000000098"); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO core_checkpoints(run_id,checkpoint_sequence,idempotency_key,request_hash,response) VALUES($1,0,'legacy-checkpoint',decode('00','hex'),'{}')`, legacyRunID); err != nil {
		t.Fatal(err)
	}
	legacyPendingID := "00000000-0000-4000-8000-000000000097"
	if _, err = pool.Exec(ctx, `INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,writer_token_hash,last_contact,completed_at,completion_reason,completion_event_id) VALUES($1,$2,1,'legacy-sim','legacy-gen','legacy-config','{}','pending_verification',decode('00','hex'),now(),now(),'death',$3)`, legacyPendingID, "00000000-0000-4000-8000-000000000096", "00000000-0000-4000-8000-000000000095"); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO core_checkpoints(run_id,checkpoint_sequence,idempotency_key,request_hash,response) VALUES($1,0,'legacy-pending-checkpoint',decode('00','hex'),'{}')`, legacyPendingID); err != nil {
		t.Fatal(err)
	}
	if err = migrations.ApplyThrough(ctx, pool, 3); err != nil {
		t.Fatalf("apply pre-delivery-lifecycle migrations: %v", err)
	}
	legacyRejectedID := "00000000-0000-4000-8000-000000000094"
	if _, err = pool.Exec(ctx, `INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,verification_status,delivery_status,writer_token_hash,last_contact,completed_at,completion_reason) VALUES($1,$2,1,'legacy-sim','legacy-gen','legacy-config','{}','rejected','verified','rejected',decode('00','hex'),now(),now(),'death')`, legacyRejectedID, "00000000-0000-4000-8000-000000000093"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- migrations.Apply(ctx, pool) }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent migration: %v", err)
		}
	}
	var verification, delivery string
	var oldEvidence []byte
	if err = pool.QueryRow(ctx, `SELECT verification_status,delivery_status FROM core_runs WHERE id=$1`, legacyRunID).Scan(&verification, &delivery); err != nil || verification != "verified" || delivery != "delivered" {
		t.Fatalf("legacy completion migration status verification=%s delivery=%s err=%v", verification, delivery, err)
	}
	if err = pool.QueryRow(ctx, `SELECT input_batch FROM core_checkpoints WHERE run_id=$1`, legacyRunID).Scan(&oldEvidence); err != nil || string(oldEvidence) != "[]" {
		t.Fatalf("legacy checkpoint evidence migration value=%s err=%v", oldEvidence, err)
	}
	var lifecycle, pendingVerification, pendingDelivery string
	if err = pool.QueryRow(ctx, `SELECT status,verification_status,delivery_status FROM core_runs WHERE id=$1`, legacyPendingID).Scan(&lifecycle, &pendingVerification, &pendingDelivery); err != nil || lifecycle != "completed" || pendingVerification != "verified" || pendingDelivery != "pending" {
		t.Fatalf("legacy pending migration status=%s verification=%s delivery=%s err=%v", lifecycle, pendingVerification, pendingDelivery, err)
	}
	if err = pool.QueryRow(ctx, `SELECT status,verification_status,delivery_status FROM core_runs WHERE id=$1`, legacyRejectedID).Scan(&lifecycle, &pendingVerification, &pendingDelivery); err != nil || lifecycle != "completed" || pendingVerification != "verified" || pendingDelivery != "rejected" {
		t.Fatalf("legacy rejected-delivery migration status=%s verification=%s delivery=%s err=%v", lifecycle, pendingVerification, pendingDelivery, err)
	}
	var indexDefinition string
	if err = pool.QueryRow(ctx, `SELECT pg_get_indexdef('core_one_active_run_per_account'::regclass)`).Scan(&indexDefinition); err != nil || !strings.Contains(indexDefinition, "completion_pending") || strings.Contains(indexDefinition, "pending_verification") {
		t.Fatalf("partial unique index was not upgraded: %s err=%v", indexDefinition, err)
	}
	return pool
}

func TestPostgresCompletionOutboxRetriesAndOutageGrace(t *testing.T) {
	pool := testPool(t)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Now().UTC().Truncate(time.Second)
	server := &Server{DB: pool, Auth: JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}, Now: func() time.Time { return clock }}, OperatorToken: "operator-test", OutboxConfigured: true, Now: func() time.Time { return clock }}
	app := httptest.NewServer(server.Handler())
	defer app.Close()
	auth := func() string { return integrationTokenAt(t, priv, "00000000-0000-4000-8000-000000000011", clock) }
	resp := request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs", auth(), nil)
	var run Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&run)
	resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("create status=%d", resp.StatusCode)
	}
	state := run.State
	if state.Descriptor.SimulationVersion != sim.SimulationVersion || state.Descriptor.GeneratorVersion != sim.GeneratorVersion || state.Descriptor.ConfigID != sim.DefaultConfigID || state.Config.Wetland == nil || state.Config.Wetland.CatalogVersion != 3 {
		t.Fatalf("new run did not pin paired-route rules: %+v", state.Descriptor)
	}
	var ticks [][]sim.Input
	for i := 0; i < CheckpointTickLimit; i++ {
		inputs := []sim.Input(nil)
		if i == 0 {
			inputs = []sim.Input{{Sequence: 0, Action: "FLAP"}}
		}
		ticks = append(ticks, inputs)
		step, e := sim.Step(state, inputs)
		if e != nil {
			t.Fatal(e)
		}
		state = step.State
		if state.Phase == sim.Dead {
			break
		}
	}
	if state.Phase != sim.Dead || len(ticks) > CheckpointTickLimit {
		t.Fatalf("test flight did not end in one bounded checkpoint after %d ticks", len(ticks))
	}
	payload := map[string]any{"checkpointSequence": 0, "writerGeneration": run.WriterGeneration, "writerToken": run.WriterToken, "idempotencyKey": "completion-checkpoint", "ticks": ticks}
	resp = request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs/"+run.RunID+"/checkpoints", auth(), payload)
	var completed Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&completed)
	resp.Body.Close()
	if resp.StatusCode != 200 || completed.Status != "completed" || completed.VerificationStatus != "verified" || completed.DeliveryStatus != "pending" || completed.CompletionReason != "death" {
		t.Fatalf("completion ack status=%d snapshot=%+v", resp.StatusCode, completed)
	}
	resp = request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs", auth(), nil)
	var next Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&next)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || next.Status != "active" {
		t.Fatalf("delivery-pending verified completion blocked next flight: status=%d snapshot=%+v", resp.StatusCode, next)
	}

	var bodies [][]byte
	rejectNextDelivery := false
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodies = append(bodies, body)
		if rejectNextDelivery {
			rejectNextDelivery = false
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		if len(bodies) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer account.Close()
	worker := &CompletionWorker{DB: pool, Endpoint: account.URL + "/internal/v1/run-completions", ServiceToken: "service-test", Client: account.Client(), Now: func() time.Time { return clock }}
	if sent, e := worker.DispatchOne(context.Background()); e != nil || !sent {
		t.Fatalf("first outbox attempt sent=%v err=%v", sent, e)
	}
	var status, verification, delivery string
	if err = pool.QueryRow(context.Background(), `SELECT status,verification_status,delivery_status FROM core_runs WHERE id=$1`, run.RunID).Scan(&status, &verification, &delivery); err != nil || status != "completed" || verification != "verified" || delivery != "pending" {
		t.Fatalf("retryable delivery changed verified result: status=%s verification=%s delivery=%s err=%v", status, verification, delivery, err)
	}
	resp = request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/current", auth(), nil)
	var current Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&current)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || current.RunID != next.RunID || current.Status != "active" {
		t.Fatalf("delivery retry displaced the newer flight: status=%d snapshot=%+v", resp.StatusCode, current)
	}
	var attempts int
	var eventID string
	if err = pool.QueryRow(context.Background(), `SELECT attempts,event_id::text FROM core_outbox WHERE run_id=$1`, run.RunID).Scan(&attempts, &eventID); err != nil || attempts != 1 {
		t.Fatalf("first attempt persistence attempts=%d err=%v", attempts, err)
	}
	_, err = pool.Exec(context.Background(), `UPDATE core_outbox SET status='leased',lease_until=$2,lease_token=$3 WHERE run_id=$1`, run.RunID, clock.Add(-time.Second), "00000000-0000-4000-8000-000000000099")
	if err != nil {
		t.Fatal(err)
	}
	if sent, e := worker.DispatchOne(context.Background()); e != nil || !sent {
		t.Fatalf("recovered outbox attempt sent=%v err=%v", sent, e)
	}
	if len(bodies) != 2 || !bytes.Equal(bodies[0], bodies[1]) {
		t.Fatal("outbox retry changed event payload")
	}
	var event map[string]any
	if err = json.Unmarshal(bodies[1], &event); err != nil {
		t.Fatal(err)
	}
	if event["event_id"] != eventID || event["type"] != "RunLifeCompleted.v1" || event["reason"] != "death" {
		t.Fatalf("bad completion event: %#v", event)
	}
	if err = pool.QueryRow(context.Background(), `SELECT status,verification_status,delivery_status FROM core_runs WHERE id=$1`, run.RunID).Scan(&status, &verification, &delivery); err != nil || status != "completed" || verification != "verified" || delivery != "delivered" {
		t.Fatalf("delivery ack changed verified lifecycle: status=%s verification=%s delivery=%s err=%v", status, verification, delivery, err)
	}

	state = next.State
	ticks = ticks[:0]
	for i := 0; i < CheckpointTickLimit && state.Phase != sim.Dead; i++ {
		inputs := []sim.Input(nil)
		if i == 0 {
			inputs = []sim.Input{{Sequence: 0, Action: "FLAP"}}
		}
		ticks = append(ticks, inputs)
		step, stepErr := sim.Step(state, inputs)
		if stepErr != nil {
			t.Fatal(stepErr)
		}
		state = step.State
	}
	if state.Phase != sim.Dead {
		t.Fatal("second test flight did not end within one checkpoint")
	}
	secondPayload := map[string]any{"checkpointSequence": 0, "writerGeneration": next.WriterGeneration, "writerToken": next.WriterToken, "idempotencyKey": "permanent-rejection-checkpoint", "ticks": ticks}
	resp = request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs/"+next.RunID+"/checkpoints", auth(), secondPayload)
	var secondCompleted Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&secondCompleted)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || secondCompleted.Status != "completed" || secondCompleted.VerificationStatus != "verified" || secondCompleted.DeliveryStatus != "pending" {
		t.Fatalf("second completion status=%d snapshot=%+v", resp.StatusCode, secondCompleted)
	}
	rejectNextDelivery = true
	if sent, e := worker.DispatchOne(context.Background()); e != nil || !sent {
		t.Fatalf("permanent rejection delivery sent=%v err=%v", sent, e)
	}
	if err = pool.QueryRow(context.Background(), `SELECT status,verification_status,delivery_status FROM core_runs WHERE id=$1`, next.RunID).Scan(&status, &verification, &delivery); err != nil || status != "completed" || verification != "verified" || delivery != "rejected" {
		t.Fatalf("permanent delivery rejection changed verified result: status=%s verification=%s delivery=%s err=%v", status, verification, delivery, err)
	}
	resp = request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs", auth(), nil)
	var third Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&third)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || third.Status != "active" {
		t.Fatalf("permanent receipt rejection blocked next flight: status=%d snapshot=%+v", resp.StatusCode, third)
	}

	clock = clock.Add(30 * time.Minute)
	outageBody := map[string]any{"startedAt": clock.Format(time.RFC3339)}
	req, _ := http.NewRequest(http.MethodPost, app.URL+"/internal/v1/outages/start", strings.NewReader(mustJSON(outageBody)))
	req.Header.Set("Authorization", "Bearer operator-test")
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var outage struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&outage)
	resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("outage start status=%d", resp.StatusCode)
	}
	clock = clock.Add(90 * time.Minute)
	recoverReq, _ := http.NewRequest(http.MethodPost, app.URL+"/internal/v1/outages/"+outage.ID+"/recover", strings.NewReader(mustJSON(map[string]any{"recoveredAt": clock.Format(time.RFC3339)})))
	recoverReq.Header.Set("Authorization", "Bearer operator-test")
	recoverReq.Header.Set("Content-Type", "application/json")
	resp, err = app.Client().Do(recoverReq)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("outage recover status=%d", resp.StatusCode)
	}
	resp = request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/current", auth(), nil)
	var recovered Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&recovered)
	resp.Body.Close()
	if resp.StatusCode != 200 || recovered.RunID != third.RunID || !recovered.SubmissionDeadline.Equal(clock.Add(time.Hour)) {
		t.Fatalf("outage grace snapshot status=%d deadline=%s expected=%s", resp.StatusCode, recovered.SubmissionDeadline, clock.Add(time.Hour))
	}
	clock = clock.Add(time.Hour + time.Second)
	for i := 0; i < 2; i++ {
		resp = request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/"+third.RunID, auth(), nil)
		var expired Snapshot
		_ = json.NewDecoder(resp.Body).Decode(&expired)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || expired.Status != "rejected" || expired.VerificationStatus != "rejected" {
			t.Fatalf("direct expired run read %d status=%d verification=%s", i, resp.StatusCode, expired.VerificationStatus)
		}
	}
	resp = request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/current", auth(), nil)
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("expired run remained active: status=%d", resp.StatusCode)
	}
	if err = pool.QueryRow(context.Background(), `SELECT status FROM core_runs WHERE id=$1`, third.RunID).Scan(&status); err != nil || status != "rejected" {
		t.Fatalf("expired run status=%s err=%v", status, err)
	}
}

func mustJSON(value any) string { encoded, _ := json.Marshal(value); return string(encoded) }

func TestPostgresInflightQueueWaitsAndRejectsOverflowWithoutMutation(t *testing.T) {
	pool := testPool(t)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	token := integrationToken(t, priv)
	server := &Server{DB: pool, Auth: JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}}, OutboxConfigured: true, MaxInflight: 1, MaxQueued: 1}
	app := httptest.NewServer(server.Handler())
	defer app.Close()
	created := request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs", token, nil)
	var run Snapshot
	_ = json.NewDecoder(created.Body).Decode(&run)
	created.Body.Close()
	if created.StatusCode != 201 {
		t.Fatalf("create status=%d", created.StatusCode)
	}
	lock, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = lock.Exec(context.Background(), `SELECT id FROM core_runs WHERE id=$1 FOR UPDATE`, run.RunID); err != nil {
		t.Fatal(err)
	}
	checkpoint := map[string]any{"checkpointSequence": 0, "writerGeneration": 1, "writerToken": run.WriterToken, "idempotencyKey": "inflight-one", "ticks": [][]sim.Input{{{Sequence: 0, Action: "FLAP"}}}}
	done := make(chan *http.Response, 1)
	go func() {
		done <- request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs/"+run.RunID+"/checkpoints", token, checkpoint)
	}()
	until := time.Now().Add(2 * time.Second)
	for len(server.RequestSlots) != 1 && time.Now().Before(until) {
		time.Sleep(time.Millisecond)
	}
	if len(server.RequestSlots) != 1 {
		_ = lock.Rollback(context.Background())
		t.Fatal("checkpoint did not acquire the single request slot")
	}
	queuedDone := make(chan *http.Response, 1)
	go func() {
		queuedDone <- request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/current", token, nil)
	}()
	until = time.Now().Add(2 * time.Second)
	for len(server.QueuedRequests) != 1 && time.Now().Before(until) {
		time.Sleep(time.Millisecond)
	}
	if len(server.QueuedRequests) != 1 {
		_ = lock.Rollback(context.Background())
		t.Fatal("second request did not enter the bounded admission queue")
	}
	rejected := request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/current", token, nil)
	if rejected.StatusCode != 429 || rejected.Header.Get("Retry-After") != "1" {
		t.Fatalf("inflight rejection status=%d retry=%q", rejected.StatusCode, rejected.Header.Get("Retry-After"))
	}
	rejected.Body.Close()
	var sequence int64
	if err = pool.QueryRow(context.Background(), `SELECT checkpoint_sequence FROM core_runs WHERE id=$1`, run.RunID).Scan(&sequence); err != nil || sequence != -1 {
		t.Fatalf("overloaded request mutated run: sequence=%d err=%v", sequence, err)
	}
	if err = lock.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	accepted := <-done
	if accepted.StatusCode != 200 {
		t.Fatalf("checkpoint after slot release status=%d", accepted.StatusCode)
	}
	accepted.Body.Close()
	queued := <-queuedDone
	if queued.StatusCode != 200 {
		t.Fatalf("queued request after slot release status=%d", queued.StatusCode)
	}
	queued.Body.Close()
	if err = pool.QueryRow(context.Background(), `SELECT checkpoint_sequence FROM core_runs WHERE id=$1`, run.RunID).Scan(&sequence); err != nil || sequence != 0 {
		t.Fatalf("released checkpoint missing: sequence=%d err=%v", sequence, err)
	}
}

func TestPostgresBestScoreProjectionIsMonotonicAndAccountScoped(t *testing.T) {
	pool := testPool(t)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: pool, Auth: JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}}, OutboxConfigured: true}
	app := httptest.NewServer(server.Handler())
	defer app.Close()
	account := "00000000-0000-4000-8000-000000000041"
	other := "00000000-0000-4000-8000-000000000042"
	promoted := "00000000-0000-4000-8000-000000000043"
	token := integrationTokenFor(t, priv, account)
	otherToken := integrationTokenFor(t, priv, other)
	promotedToken := integrationTokenFor(t, priv, promoted)
	readBest := func(auth string) int64 {
		resp := request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/progress", auth, nil)
		defer resp.Body.Close()
		var body struct {
			BestScore int64 `json:"bestScore"`
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("best score status=%d", resp.StatusCode)
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return body.BestScore
	}
	if got := readBest(token); got != 0 {
		t.Fatalf("new account best score=%d", got)
	}
	if _, err = pool.Exec(context.Background(), `INSERT INTO core_account_progress(account_id,best_score) VALUES($1,99)`, account); err != nil {
		t.Fatal(err)
	}
	runResp := request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs", token, nil)
	var run Snapshot
	_ = json.NewDecoder(runResp.Body).Decode(&run)
	runResp.Body.Close()
	if runResp.StatusCode != http.StatusCreated {
		t.Fatalf("create status=%d", runResp.StatusCode)
	}
	state := run.State
	ticks := make([][]sim.Input, 0, CheckpointTickLimit)
	for i := 0; i < CheckpointTickLimit && state.Phase != sim.Dead; i++ {
		inputs := []sim.Input{}
		if state.Phase == sim.Ready {
			inputs = append(inputs, sim.Input{Sequence: 0, Action: "FLAP"})
		}
		ticks = append(ticks, inputs)
		step, stepErr := sim.Step(state, inputs)
		if stepErr != nil {
			t.Fatal(stepErr)
		}
		state = step.State
	}
	if state.Phase != sim.Dead {
		t.Fatal("expected death within one checkpoint")
	}
	body := map[string]any{"checkpointSequence": 0, "writerGeneration": run.WriterGeneration, "writerToken": run.WriterToken, "idempotencyKey": "best-score-checkpoint", "ticks": ticks}
	resp := request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs/"+run.RunID+"/checkpoints", token, body)
	var completed Snapshot
	_ = json.NewDecoder(resp.Body).Decode(&completed)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || completed.VerificationStatus != "verified" {
		t.Fatalf("verified checkpoint status=%d verification=%s", resp.StatusCode, completed.VerificationStatus)
	}
	if got := readBest(token); got != 99 {
		t.Fatalf("lower verified run reduced best score to %d", got)
	}
	if got := readBest(otherToken); got != 0 {
		t.Fatalf("other account saw best score %d", got)
	}
	if got := readBest(promotedToken); got != 0 {
		t.Fatalf("new promotion account best score=%d", got)
	}
	positiveResp := request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs", promotedToken, nil)
	var positiveRun Snapshot
	_ = json.NewDecoder(positiveResp.Body).Decode(&positiveRun)
	positiveResp.Body.Close()
	if positiveResp.StatusCode != http.StatusCreated {
		t.Fatalf("positive run create status=%d", positiveResp.StatusCode)
	}
	config := sim.PriorDefaultConfiguration()
	configID, err := sim.ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err = sim.CreateRun(sim.Descriptor{RunID: positiveRun.RunID, Seed: 42, SimulationVersion: sim.PriorSimulationVersion, GeneratorVersion: sim.PriorGeneratorVersion, ConfigID: configID}, config)
	if err != nil {
		t.Fatal(err)
	}
	stateBytes, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(context.Background(), `UPDATE core_runs SET seed=42,state=$2 WHERE id=$1`, positiveRun.RunID, stateBytes); err != nil {
		t.Fatal(err)
	}
	nextInputSequence := int64(0)
	checkpointSequence := int64(0)
	submitTicks := func(ticks [][]sim.Input, expected sim.State) Snapshot {
		body := map[string]any{"checkpointSequence": checkpointSequence, "writerGeneration": positiveRun.WriterGeneration, "writerToken": positiveRun.WriterToken, "idempotencyKey": fmt.Sprintf("promoted-%d", checkpointSequence), "ticks": ticks}
		resp := request(t, app.Client(), http.MethodPost, app.URL+"/api/v1/runs/"+positiveRun.RunID+"/checkpoints", promotedToken, body)
		var result Snapshot
		_ = json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || result.State.Score != expected.Score {
			t.Fatalf("positive checkpoint %d status=%d score=%d want=%d", checkpointSequence, resp.StatusCode, result.State.Score, expected.Score)
		}
		checkpointSequence++
		return result
	}
	for tick := 0; tick < 300; {
		batch := make([][]sim.Input, 0, CheckpointTickLimit)
		for len(batch) < CheckpointTickLimit && tick < 300 {
			inputs := []sim.Input{}
			if state.Phase == sim.Ready {
				inputs = append(inputs, sim.Input{Sequence: nextInputSequence, Action: "FLAP"})
				nextInputSequence++
			} else {
				target := state.Pipes[0].GapCenter
				for _, pipe := range state.Pipes {
					if pipe.X+config.Pipes.Width/2 >= config.Flight.DuckX-config.Flight.DuckHalfWidth {
						target = pipe.GapCenter
						break
					}
				}
				if state.Duck.Y > target-12000 && state.Duck.VY > -1600 {
					inputs = append(inputs, sim.Input{Sequence: nextInputSequence, Action: "FLAP"})
					nextInputSequence++
				}
			}
			step, stepErr := sim.Step(state, inputs)
			if stepErr != nil {
				t.Fatal(stepErr)
			}
			state = step.State
			batch = append(batch, inputs)
			tick++
		}
		submitTicks(batch, state)
	}
	if state.Score < 1 || readBest(promotedToken) != 0 {
		t.Fatalf("active run should not publish score: run=%d best=%d", state.Score, readBest(promotedToken))
	}
	deathBatch := make([][]sim.Input, 0, CheckpointTickLimit)
	for len(deathBatch) < CheckpointTickLimit && state.Phase != sim.Dead {
		step, stepErr := sim.Step(state, nil)
		if stepErr != nil {
			t.Fatal(stepErr)
		}
		state = step.State
		deathBatch = append(deathBatch, []sim.Input{})
	}
	if state.Phase != sim.Dead {
		t.Fatal("deterministic positive-score run did not reach death")
	}
	positiveCompleted := submitTicks(deathBatch, state)
	if positiveCompleted.VerificationStatus != "verified" || positiveCompleted.State.Score < 1 {
		t.Fatalf("positive run completion verification=%s score=%d, want a verified positive score", positiveCompleted.VerificationStatus, positiveCompleted.State.Score)
	}
	if got := readBest(promotedToken); got != positiveCompleted.State.Score || got != state.Score {
		t.Fatalf("verified positive score was not published: best=%d completed=%d local=%d", got, positiveCompleted.State.Score, state.Score)
	}
}
