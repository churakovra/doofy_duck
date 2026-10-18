package simulation

import (
	"encoding/json"
	"os"
	"testing"
)

func TestStarScheduleMatchesAuthoredParityVectors(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/star-schedule-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Schedule struct {
			MinIntervalPipes int64 `json:"minIntervalPipes"`
			MaxIntervalPipes int64 `json:"maxIntervalPipes"`
			Amount           int64 `json:"amount"`
		} `json:"schedule"`
		Cases []struct {
			Seed               int64 `json:"seed"`
			FirstStarPipeIndex int64 `json:"firstStarPipeIndex"`
			NextStarPipeIndex  int64 `json:"nextStarPipeIndex"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, example := range fixture.Cases {
		config := PriorDefaultConfiguration()
		id, err := ConfigIDFor(config)
		if err != nil {
			t.Fatal(err)
		}
		state, err := CreateRun(Descriptor{RunID: "star-vector", Seed: example.Seed, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: id}, config)
		if err != nil {
			t.Fatal(err)
		}
		if state.NextStarPipeIndex != example.FirstStarPipeIndex {
			t.Fatalf("seed %d first target=%d, want %d", example.Seed, state.NextStarPipeIndex, example.FirstStarPipeIndex)
		}
		state.Phase = Running
		state.NextSpawnPipeIndex = example.FirstStarPipeIndex
		state.Pipes = []Pipe{{ID: "pipe", Index: example.FirstStarPipeIndex, X: 900000, GapCenter: 280000}}
		result, err := Step(state, nil)
		if err != nil {
			t.Fatal(err)
		}
		if result.State.NextStarPipeIndex != example.NextStarPipeIndex {
			t.Fatalf("seed %d next target=%d, want %d", example.Seed, result.State.NextStarPipeIndex, example.NextStarPipeIndex)
		}
		found := false
		for _, collectible := range result.State.Collectibles {
			if collectible.TypeID == "GAME_STAR" {
				found = collectible.Amount == fixture.Schedule.Amount
			}
		}
		if !found {
			t.Fatalf("seed %d omitted one-unit scheduled Star", example.Seed)
		}
	}
}

func TestStarScheduleIntervalsAndReservedCapacity(t *testing.T) {
	firstIntervals := map[int64]bool{}
	laterIntervals := map[int64]bool{}
	for seed := int64(0); seed < 64; seed++ {
		config := PriorDefaultConfiguration()
		id, err := ConfigIDFor(config)
		if err != nil {
			t.Fatal(err)
		}
		state, err := CreateRun(Descriptor{RunID: "star-schedule", Seed: seed, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: id}, config)
		if err != nil {
			t.Fatal(err)
		}
		first := state.NextStarPipeIndex
		firstIntervals[first] = true
		if first < 8 || first > 16 {
			t.Fatalf("seed %d first Star pipe = %d, want 8..16", seed, first)
		}
		state.Phase = Running
		state.NextSpawnPipeIndex = first
		state.Pipes = []Pipe{{ID: "pipe", Index: first, X: 900000, GapCenter: 280000}}
		state.Collectibles = []Collectible{
			{ID: "coin-a", TypeID: "FEATHER", X: 800000, Y: 100000, Amount: 1, Radius: 7000},
			{ID: "coin-b", TypeID: "FEATHER", X: 800001, Y: 100000, Amount: 1, Radius: 7000},
		}
		result, err := Step(state, nil)
		if err != nil {
			t.Fatal(err)
		}
		gap := result.State.NextStarPipeIndex - first
		laterIntervals[gap] = true
		if gap < 8 || gap > 16 {
			t.Fatalf("seed %d next Star gap = %d, want 8..16", seed, gap)
		}
		stars, coins := 0, 0
		for _, collectible := range result.State.Collectibles {
			if collectible.TypeID == "GAME_STAR" {
				stars++
			}
			if collectible.TypeID == "FEATHER" {
				coins++
			}
		}
		if stars != 1 || coins != 2 || len(result.State.Collectibles) != int(config.Limits.MaxActiveCollectibles) {
			t.Fatalf("seed %d collectible capacity: stars=%d coins=%d total=%d", seed, stars, coins, len(result.State.Collectibles))
		}
	}
	if !firstIntervals[8] || !firstIntervals[16] || !laterIntervals[8] || !laterIntervals[16] {
		t.Fatalf("seed sample missed inclusive schedule boundaries: first=%v later=%v", firstIntervals, laterIntervals)
	}
}

func TestScheduledStarConfigRequiresCapacityAndTravelDistance(t *testing.T) {
	config := PriorDefaultConfiguration()
	config.Limits.MaxActiveCollectibles = 2
	if err := ValidateConfig(config); err == nil {
		t.Fatal("accepted a scheduled Star config without a reserved slot")
	}
	config = PriorDefaultConfiguration()
	config.Pipes.Spacing = 100000
	if err := ValidateConfig(config); err == nil {
		t.Fatal("accepted a scheduled Star config whose prior Star can remain visible")
	}
	config = PriorDefaultConfiguration()
	config.Pipes.Spacing = 121000
	if err := ValidateConfig(config); err == nil {
		t.Fatal("accepted a scheduled Star config that can overlap the prune boundary")
	}
}

func TestExplicitNullStarConfigMatchesFrozenLegacyState(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/golden-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			InitialState State `json:"initialState"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	expected := fixture.Cases[0].InitialState
	configBytes, err := json.Marshal(expected.Config)
	if err != nil {
		t.Fatal(err)
	}
	var configObject map[string]json.RawMessage
	if err := json.Unmarshal(configBytes, &configObject); err != nil {
		t.Fatal(err)
	}
	configObject["starSchedule"] = json.RawMessage("null")
	configBytes, err = json.Marshal(configObject)
	if err != nil {
		t.Fatal(err)
	}
	var config Config
	if err := json.Unmarshal(configBytes, &config); err != nil {
		t.Fatal(err)
	}
	actual, err := CreateRun(expected.Descriptor, config)
	if err != nil {
		t.Fatal(err)
	}
	expectedCanonical, err := CanonicalJSON(expected)
	if err != nil {
		t.Fatal(err)
	}
	actualCanonical, err := CanonicalJSON(actual)
	if err != nil {
		t.Fatal(err)
	}
	if actualCanonical != expectedCanonical {
		t.Fatal("explicit null Star config changed the frozen legacy state")
	}
}

func TestMinimumValidStarPruneSpacingRunsWithoutOverlap(t *testing.T) {
	config := PriorDefaultConfiguration()
	config.Challenges = nil
	config.Pipes.Spacing = 121251
	config.Pipes.MaxSpeed = 3000
	config.Pipes.GapMinCenter = 280000
	config.Pipes.GapMaxCenter = 280000
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "star-prune-valid-boundary", Seed: 0, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase = Running
	for tick := 0; tick < 1000 && (state.StarScheduleOrdinal == nil || *state.StarScheduleOrdinal < 2); tick++ {
		state.Duck.Y = 280500
		state.Duck.VY = -config.Flight.Gravity
		result, stepErr := Step(state, nil)
		if stepErr != nil {
			t.Fatalf("tick %d: %v", tick, stepErr)
		}
		state = result.State
	}
	if state.StarScheduleOrdinal == nil || *state.StarScheduleOrdinal < 2 {
		t.Fatalf("did not generate two scheduled Stars: ordinal=%v", state.StarScheduleOrdinal)
	}
}

func TestScheduledStarSuppressesSamePipeCoinAfterAdvancingCoinRNG(t *testing.T) {
	config := PriorDefaultConfiguration()
	config.SpawnNoneWeight = 0
	for i := range config.Collectibles {
		if config.Collectibles[i].TypeID == "FEATHER" {
			config.Collectibles[i].Weight = 1
		}
	}
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "star-coin-collision", Seed: 42, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	initialRNG, initialCooldown := state.RNGState, state.LastCollectiblePipe
	target := state.NextStarPipeIndex
	state.Phase = Running
	state.NextSpawnPipeIndex = target
	state.Pipes = []Pipe{{ID: "pipe", Index: target, X: 900000, GapCenter: 280000}}
	result, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.State.Collectibles) != 1 || result.State.Collectibles[0].TypeID != "GAME_STAR" {
		t.Fatalf("same-pipe coin was not suppressed: %+v", result.State.Collectibles)
	}
	if result.State.LastCollectiblePipe != initialCooldown {
		t.Fatalf("scheduled Star changed ordinary collectible cooldown: got %d want %d", result.State.LastCollectiblePipe, initialCooldown)
	}
	if result.State.RNGState != initialRNG+0x9e3779b9 {
		t.Fatalf("coin RNG did not advance on scheduled pipe: got %d want %d", result.State.RNGState, initialRNG+0x9e3779b9)
	}
}

func TestPauseResumePreservesScheduledStarReplay(t *testing.T) {
	config := PriorDefaultConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := Descriptor{RunID: "star-pause", Seed: 981, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: id}
	initial, err := CreateRun(descriptor, config)
	if err != nil {
		t.Fatal(err)
	}
	initial.Phase = Running
	paused, err := Pause(initial)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := Resume(paused)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.NextStarPipeIndex != initial.NextStarPipeIndex || resumed.StarScheduleOrdinal == nil || *resumed.StarScheduleOrdinal != 0 {
		t.Fatalf("pause/resume changed scheduled Star cursor: initial=%d resumed=%d ordinal=%v", initial.NextStarPipeIndex, resumed.NextStarPipeIndex, resumed.StarScheduleOrdinal)
	}
	input := Input{Sequence: 0, Action: "FLAP"}
	left, err := Step(resumed, []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := Step(resumed, []Input{input})
	if err != nil {
		t.Fatal(err)
	}
	leftBytes, err := json.Marshal(left)
	if err != nil {
		t.Fatal(err)
	}
	rightBytes, err := json.Marshal(replayed)
	if err != nil {
		t.Fatal(err)
	}
	if string(leftBytes) != string(rightBytes) {
		t.Fatal("scheduled Star replay diverged after pause/resume")
	}
}

func TestLegacyDescriptorUsesLegacyRules(t *testing.T) {
	config := LegacyDefaultConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	if id != LegacyDefaultConfigID {
		t.Fatalf("legacy config ID = %q", id)
	}
	state, err := CreateRun(Descriptor{RunID: "legacy", Seed: 7, SimulationVersion: LegacySimulationVersion, GeneratorVersion: LegacyGeneratorVersion, ConfigID: id})
	if err != nil {
		t.Fatal(err)
	}
	if state.NextStarPipeIndex != 0 || state.Config.StarSchedule != nil {
		t.Fatalf("legacy config acquired scheduled Stars: %+v", state.Config.StarSchedule)
	}
}

func TestScheduledStarPickupCreditsExactlyOne(t *testing.T) {
	config := PriorDefaultConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := Descriptor{RunID: "star-pickup", Seed: 12, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: id}
	state, err := CreateRun(descriptor, config)
	if err != nil {
		t.Fatal(err)
	}
	index := state.NextStarPipeIndex
	pipe := Pipe{ID: "star-pipe", Index: index, X: config.Flight.DuckX + config.Pipes.Speed, GapCenter: 280000}
	moved := pipe
	moved.X -= config.Pipes.Speed
	state.Phase = Running
	state.Duck.Y = bonusY(config, uint32(descriptor.Seed), moved, config.Collectibles[1].Radius)
	state.Duck.VY = -config.Flight.Gravity
	state.Pipes = []Pipe{pipe}
	state.NextSpawnPipeIndex = index
	result, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.State.Totals["GAME_STAR"] != 1 || len(result.State.Collectibles) != 0 {
		t.Fatalf("Star pickup total=%d collectibles=%v", result.State.Totals["GAME_STAR"], result.State.Collectibles)
	}
	found := false
	for _, event := range result.Events {
		if event.Type == "CurrencyCollected" && event.TypeID == "GAME_STAR" && event.Amount != nil && *event.Amount == 1 {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing one-unit Star pickup event: %+v", result.Events)
	}
}

func TestUncollectedScheduledStarExpiresWithoutMovingItsNextTarget(t *testing.T) {
	config := PriorDefaultConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := Descriptor{RunID: "star-uncollected", Seed: 12, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: id}
	state, err := CreateRun(descriptor, config)
	if err != nil {
		t.Fatal(err)
	}
	first := state.NextStarPipeIndex
	state.Phase = Running
	state.NextSpawnPipeIndex = first
	state.Pipes = []Pipe{{ID: "pipe", Index: first, X: 900000, GapCenter: 280000}}
	spawned, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	starIndex := -1
	for i := range spawned.State.Collectibles {
		if spawned.State.Collectibles[i].TypeID == "GAME_STAR" {
			starIndex = i
			break
		}
	}
	if starIndex < 0 {
		t.Fatal("scheduled Star was not spawned")
	}
	star := spawned.State.Collectibles[starIndex]
	spawned.State.Collectibles[starIndex].X = -star.Radius + config.Pipes.Speed - 1
	nextTarget := spawned.State.NextStarPipeIndex
	expired, err := Step(spawned.State, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, collectible := range expired.State.Collectibles {
		if collectible.TypeID == "GAME_STAR" {
			t.Fatal("uncollected Star did not expire offscreen")
		}
	}
	if expired.State.NextStarPipeIndex != nextTarget {
		t.Fatalf("next target changed while an uncollected Star expired: got %d want %d", expired.State.NextStarPipeIndex, nextTarget)
	}
}
