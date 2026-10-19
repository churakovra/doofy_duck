package core

import (
	"encoding/json"
	"testing"

	sim "doofyduck/simulation"
)

func TestReplayCheckpointRoundTripsVariedObstacleState(t *testing.T) {
	config := sim.VariedObstacleConfiguration()
	configID, err := sim.ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := sim.CreateRun(sim.Descriptor{RunID: "varied-replay", Seed: 7, SimulationVersion: sim.VariedObstacleSimulationVersion, GeneratorVersion: sim.VariedObstacleGeneratorVersion, ConfigID: configID}, config)
	if err != nil {
		t.Fatal(err)
	}
	if state.Descriptor.ConfigID != sim.VariedObstacleDefaultConfigID || state.Config.Wetland.CatalogVersion != 2 {
		t.Fatalf("unexpected varied run identity/catalog: %+v", state.Descriptor)
	}
	var recovered sim.State
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &recovered); err != nil {
		t.Fatal(err)
	}
	ticks := [][]sim.Input{{{Sequence: 0, Action: "FLAP"}}, {}, {}}
	first, firstTicks, _, err := ReplayCheckpoint(state, 0, ticks, ActiveTickLimit)
	if err != nil {
		t.Fatal(err)
	}
	second, secondTicks, _, err := ReplayCheckpoint(recovered, 0, ticks, ActiveTickLimit)
	if err != nil {
		t.Fatal(err)
	}
	firstJSON, err := sim.CanonicalJSON(first)
	if err != nil {
		t.Fatal(err)
	}
	secondJSON, err := sim.CanonicalJSON(second)
	if err != nil {
		t.Fatal(err)
	}
	if firstTicks != secondTicks || firstJSON != secondJSON {
		t.Fatalf("recovered varied state replay diverged: ticks %d/%d", firstTicks, secondTicks)
	}
}

func newState(t *testing.T) sim.State {
	t.Helper()
	config := sim.PriorDefaultConfiguration()
	configID, err := sim.ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := sim.CreateRun(sim.Descriptor{RunID: "00000000-0000-4000-8000-000000000001", Seed: 7, SimulationVersion: sim.PriorSimulationVersion, GeneratorVersion: sim.PriorGeneratorVersion, ConfigID: configID}, config)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestReplayCheckpointUsesExactTicksAndRejectsClientState(t *testing.T) {
	state := newState(t)
	got, ticks, reason, err := ReplayCheckpoint(state, 0, [][]sim.Input{{{Sequence: 0, Action: "FLAP"}}, {}, {}}, ActiveTickLimit)
	if err != nil {
		t.Fatal(err)
	}
	if ticks != 3 || got.Tick != 3 || got.NextInputSequence != 1 || reason != "" {
		t.Fatalf("unexpected replay result ticks=%d state=%+v reason=%q", ticks, got, reason)
	}
}

func TestReplayCheckpointBoundsAndSequence(t *testing.T) {
	state := newState(t)
	if _, _, _, err := ReplayCheckpoint(state, 0, nil, ActiveTickLimit); err == nil {
		t.Fatal("empty batch accepted")
	}
	if _, _, _, err := ReplayCheckpoint(state, 0, make([][]sim.Input, 121), ActiveTickLimit); err == nil {
		t.Fatal("oversized batch accepted")
	}
	if _, _, _, err := ReplayCheckpoint(state, 0, [][]sim.Input{{{Sequence: 1, Action: "FLAP"}}}, ActiveTickLimit); err == nil {
		t.Fatal("noncontiguous input accepted")
	}
}

func TestReplayCheckpointFlightCapIsServerResult(t *testing.T) {
	state := newState(t)
	state.Tick = ActiveTickLimit - 1
	state.Phase = sim.Running
	got, ticks, reason, err := ReplayCheckpoint(state, ActiveTickLimit-1, [][]sim.Input{{}}, ActiveTickLimit)
	if err != nil {
		t.Fatal(err)
	}
	if ticks != ActiveTickLimit || reason != "flight_cap" || got.Tick != ActiveTickLimit {
		t.Fatalf("cap not applied: ticks=%d reason=%q tick=%d", ticks, reason, got.Tick)
	}
}

func TestReplayCheckpointRejectsTicksBeyondCapAndPausedState(t *testing.T) {
	state := newState(t)
	state.Phase = sim.Running
	state.Tick = ActiveTickLimit - 1
	if _, _, _, err := ReplayCheckpoint(state, ActiveTickLimit-1, [][]sim.Input{{}, {}}, ActiveTickLimit); err == nil {
		t.Fatal("ticks after cap accepted")
	}
	state.Phase = sim.Paused
	if _, _, _, err := ReplayCheckpoint(state, 3, [][]sim.Input{{}}, ActiveTickLimit); err == nil {
		t.Fatal("paused state advanced")
	}
	if _, _, _, err := ReplayCheckpoint(state, -1, [][]sim.Input{{}}, ActiveTickLimit); err == nil {
		t.Fatal("negative active tick accepted")
	}
}
