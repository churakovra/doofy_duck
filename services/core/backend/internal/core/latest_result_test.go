package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sim "doofyduck/simulation"
)

func TestLatestRunRouteIsRegisteredBehindUserMiddleware(t *testing.T) {
	server := &Server{}
	resp := httptest.NewRecorder()
	server.Handler().ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/api/v1/runs/latest", nil))
	if resp.Code != http.StatusServiceUnavailable {
		t.Fatalf("latest route status without DB=%d, want middleware response %d", resp.Code, http.StatusServiceUnavailable)
	}
}

func TestLatestRunReturnsNewestOwnedSnapshotWithoutWriterToken(t *testing.T) {
	pool := testPool(t)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	const accountID = "00000000-0000-4000-8000-000000000021"
	const foreignAccountID = "00000000-0000-4000-8000-000000000022"
	server := &Server{DB: pool, Auth: JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}}, OutboxConfigured: true}
	app := httptest.NewServer(server.Handler())
	defer app.Close()
	state, err := sim.CreateRun(sim.Descriptor{RunID: "00000000-0000-4000-8000-000000000031", Seed: 7, SimulationVersion: sim.SimulationVersion, GeneratorVersion: sim.GeneratorVersion, ConfigID: sim.DefaultConfigID}, sim.DefaultConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	state.Score = 14
	state.Totals = map[string]int64{"FEATHER": 3, "GAME_STAR": 2}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	created := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	insert := func(id, owner string, createdAt time.Time) {
		t.Helper()
		_, insertErr := pool.Exec(t.Context(), `INSERT INTO core_runs(id,account_id,seed,simulation_version,generator_version,config_id,state,status,verification_status,delivery_status,writer_token_hash,last_contact,created_at,completed_at,completion_reason) VALUES($1,$2,7,$3,$4,$5,$6,'completed','verified','delivered',decode('00','hex'),$7,$8,$7,'death')`, id, owner, sim.SimulationVersion, sim.GeneratorVersion, state.Descriptor.ConfigID, stateJSON, createdAt, createdAt)
		if insertErr != nil {
			t.Fatal(insertErr)
		}
	}
	insert("00000000-0000-4000-8000-000000000031", accountID, created)
	insert("00000000-0000-4000-8000-000000000032", accountID, created) // stable ID tie-break picks this run.
	insert("00000000-0000-4000-8000-000000000040", foreignAccountID, created.Add(time.Hour))
	token := integrationTokenFor(t, priv, accountID)
	resp := request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/latest", token, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("latest status=%d", resp.StatusCode)
	}
	var payload map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal([]byte(mustJSON(payload)), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.RunID != "00000000-0000-4000-8000-000000000032" || snapshot.AccountID != accountID || snapshot.State.Score != 14 || snapshot.State.Totals["FEATHER"] != 3 {
		t.Fatalf("wrong latest account snapshot: %+v", snapshot)
	}
	if _, exists := payload["writerToken"]; exists {
		t.Fatal("latest snapshot exposed writerToken")
	}

	resp = request(t, app.Client(), http.MethodGet, app.URL+"/api/v1/runs/latest", integrationTokenFor(t, priv, "00000000-0000-4000-8000-000000000023"), nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("account without runs status=%d", resp.StatusCode)
	}
}
