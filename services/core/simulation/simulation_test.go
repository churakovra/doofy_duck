package simulation

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestCurrentContractIdentity(t *testing.T) {
	if SimulationVersion != "2.1.0" || GeneratorVersion != "2.1.0" || DefaultConfigID != "dd-v2-varied-obstacles-v1" {
		t.Fatalf("unexpected varied-obstacle identity: %s/%s/%s", SimulationVersion, GeneratorVersion, DefaultConfigID)
	}
	current, err := CreateRun(Descriptor{RunID: "current", Seed: 4, SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: DefaultConfigID})
	if err != nil || current.Config.Wetland == nil || current.Config.Wetland.CatalogVersion != 2 || current.NextPipeX == nil {
		t.Fatalf("varied-obstacle default run missing catalog/cursor: err=%v", err)
	}
	legacyWetland, err := CreateRun(Descriptor{RunID: "wetland-v2", Seed: 4, SimulationVersion: WetlandSimulationVersion, GeneratorVersion: WetlandGeneratorVersion, ConfigID: WetlandDefaultConfigID})
	if err != nil || legacyWetland.Config.Wetland == nil || legacyWetland.Config.Wetland.CatalogVersion != 1 {
		t.Fatalf("frozen wetland v2 identity is unavailable: err=%v", err)
	}
	if PriorSimulationVersion != "1.4.0" || PriorGeneratorVersion != "1.3.0" || PriorDefaultConfigID != "dd-v1-star-interval-v1" {
		t.Fatalf("unexpected contract identity: %s/%s/%s", PriorSimulationVersion, PriorGeneratorVersion, PriorDefaultConfigID)
	}
	config := PriorDefaultConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	if id != PriorDefaultConfigID {
		t.Fatalf("default config ID = %q, want %q", id, PriorDefaultConfigID)
	}
	legacyID, err := ConfigIDFor(LegacyDefaultConfiguration())
	if err != nil || legacyID != LegacyDefaultConfigID {
		t.Fatalf("legacy default config ID = %q, err=%v", legacyID, err)
	}
	prior, err := CreateRun(Descriptor{RunID: "prior", Seed: 4, SimulationVersion: PriorSimulationVersion, GeneratorVersion: PriorGeneratorVersion, ConfigID: PriorDefaultConfigID})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(prior)
	if err != nil {
		t.Fatal(err)
	}
	var priorObject map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &priorObject); err != nil {
		t.Fatal(err)
	}
	if _, ok := priorObject["nextPipeX"]; ok {
		t.Fatal("prior state gained wetland spawn cursor")
	}
	if prior.Config.Wetland != nil {
		t.Fatal("prior config gained wetland catalog")
	}
	if _, ok := priorObject["pipes"]; !ok {
		t.Fatal("prior state lost pipes")
	}
}

func TestCatalogVersionAndDescriptorPairBinding(t *testing.T) {
	config := VariedObstacleConfiguration()
	config.Pipes.Width++
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := Descriptor{RunID: "catalog-2-custom", Seed: 1, SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: id}
	if _, err := CreateRun(descriptor, config); err != nil {
		t.Fatalf("catalog-2 custom config rejected under current pair: %v", err)
	}
	for _, pair := range [][2]string{{WetlandSimulationVersion, WetlandGeneratorVersion}, {PriorSimulationVersion, PriorGeneratorVersion}, {LegacySimulationVersion, LegacyGeneratorVersion}} {
		wrong := descriptor
		wrong.SimulationVersion, wrong.GeneratorVersion = pair[0], pair[1]
		if _, err := CreateRun(wrong, config); err == nil {
			t.Errorf("catalog-2 custom config accepted under frozen pair %s/%s", pair[0], pair[1])
		}
	}
	legacy := WetlandConfiguration()
	legacy.Pipes.Width++
	legacyID, err := ConfigIDFor(legacy)
	if err != nil {
		t.Fatal(err)
	}
	legacyDescriptor := Descriptor{RunID: "catalog-1-custom", Seed: 1, SimulationVersion: WetlandSimulationVersion, GeneratorVersion: WetlandGeneratorVersion, ConfigID: legacyID}
	for _, pair := range [][2]string{{SimulationVersion, GeneratorVersion}, {WetlandSimulationVersion, WetlandGeneratorVersion}, {PriorSimulationVersion, PriorGeneratorVersion}, {LegacySimulationVersion, LegacyGeneratorVersion}} {
		legacyDescriptor.SimulationVersion, legacyDescriptor.GeneratorVersion = pair[0], pair[1]
		if _, err := CreateRun(legacyDescriptor, legacy); err != nil {
			t.Errorf("catalog-1 custom run rejected under formerly accepted pair %s/%s: %v", pair[0], pair[1], err)
		}
	}
}

func TestVariedRecoveryGeometryTracksShiftedWorld(t *testing.T) {
	const offset int64 = 600000
	cases := []struct {
		seed   uint32
		recipe []int64
	}{{0, []int64{430000, 310000, 190000, 78000}}, {2, []int64{100000, 220000, 340000, 460000}}}
	for _, testCase := range cases {
		t.Run(fmt.Sprintf("seed-%d", testCase.seed), func(t *testing.T) {
			config := VariedObstacleConfiguration()
			config.Pipes.CeilingY += offset
			config.Pipes.FloorY += offset
			config.Pipes.GapMinCenter += offset
			config.Pipes.GapMaxCenter += offset
			for i := range config.Wetland.IntroLaneCenters {
				config.Wetland.IntroLaneCenters[i] += offset
			}
			for i := range config.Wetland.Families {
				for j := range config.Wetland.Families[i].GapCenters {
					config.Wetland.Families[i].GapCenters[j] += offset
				}
			}
			if err := ValidateConfig(config); err != nil {
				t.Fatal(err)
			}
			id, err := ConfigIDFor(config)
			if err != nil {
				t.Fatal(err)
			}
			descriptor := Descriptor{RunID: "shifted-recovery", Seed: int64(testCase.seed), SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: id}
			initial, err := CreateRun(descriptor, config)
			if err != nil {
				t.Fatal(err)
			}
			for i, wantCenter := range testCase.recipe {
				nextX := config.Pipes.SafeLeadIn
				state := initial
				state.Pipes = []Pipe{}
				state.NextPipeIndex = int64(12 + i)
				state.NextPipeX = &nextX
				state.LastGapCenter = 280000 + offset
				generated, err := GenerateNext(state)
				if err != nil {
					t.Fatal(err)
				}
				pipe := generated.State.Pipes[0]
				if want := wantCenter + offset; pipe.GapCenter != want {
					t.Errorf("station %d gap=%d want=%d", pipe.Index, pipe.GapCenter, want)
				}
				for _, obstacle := range pipe.Obstacles {
					if obstacle.Height < 0 || obstacle.Y < config.Pipes.CeilingY || obstacle.Y+obstacle.Height > config.Pipes.FloorY {
						t.Errorf("station %d obstacle outside world: %+v", pipe.Index, obstacle)
					}
				}
			}
		})
	}
}

func TestPauseReturnsIndependentState(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/golden-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			Initial State `json:"initialState"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	s := f.Cases[0].Initial
	s.Phase = Running
	paused, err := Pause(s)
	if err != nil {
		t.Fatal(err)
	}
	paused.Pipes[0].X++
	if s.Pipes[0].X == paused.Pipes[0].X {
		t.Fatal("Pause output aliases source pipes")
	}
}

func TestFoundationSpeedMixerVectors(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/golden-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		MixerVectors []struct {
			Input  uint32 `json:"input"`
			Output uint32 `json:"output"`
		} `json:"mixerVectors"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.MixerVectors) == 0 {
		t.Fatal("fixture has no mixer vectors")
	}
	for _, v := range fixture.MixerVectors {
		if got := Mix32(v.Input); got != v.Output {
			t.Errorf("Mix32(%d)=%d, want %d", v.Input, got, v.Output)
		}
	}
}

func TestFoundationSpeedFullFixtureParity(t *testing.T) {
	if err := VerifyFoundationFixtures("../../../contracts/simulation/golden-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestWetlandRawFullStateAndEventFixtureParity(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/wetland-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestWetlandStepAdvancesSpawnCursorAfterEveryStationWasPruned(t *testing.T) {
	state, err := CreateRun(Descriptor{RunID: "wetland-refill", Seed: 32, SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: DefaultConfigID})
	if err != nil {
		t.Fatal(err)
	}
	state.Phase, state.Tick = Running, 2700
	state.Pipes = []Pipe{}
	state.NextPipeIndex, state.NextSpawnPipeIndex = 2, 2
	nextX := int64(500000)
	state.NextPipeX = &nextX
	state.Duck.Y, state.Duck.VY = 280000, 0
	result, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.State.Pipes) == 0 || result.State.Pipes[0].Index != 2 || result.State.Pipes[0].X != 495200 {
		t.Fatalf("refilled station = %+v, want index 2 at 495200", result.State.Pipes)
	}
	if len(result.State.Pipes) != 2 || result.State.Pipes[1].X != 795200 {
		t.Fatalf("refill did not fill the visible horizon: %+v", result.State.Pipes)
	}
	if result.State.NextPipeX == nil || *result.State.NextPipeX != 1095200 {
		t.Fatalf("next spawn cursor = %v, want 1095200", result.State.NextPipeX)
	}
}

func TestExportedDefaultsAreIndependentCopies(t *testing.T) {
	patterns := PatternCatalog()
	config := PriorDefaultConfiguration()
	patterns[0].Gaps[0]++
	config.Collectibles[0].Amount++
	if PatternCatalog()[0].Gaps[0] == patterns[0].Gaps[0] {
		t.Fatal("pattern accessor exposed canonical gaps")
	}
	if PriorDefaultConfiguration().Collectibles[0].Amount == config.Collectibles[0].Amount {
		t.Fatal("config accessor exposed canonical definitions")
	}
}

func TestReviewedWetlandStationFixture(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/wetland-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		FixtureRevision   string          `json:"fixtureRevision"`
		SimulationVersion string          `json:"simulationVersion"`
		GeneratorVersion  string          `json:"generatorVersion"`
		ConfigID          string          `json:"configId"`
		Seed              int64           `json:"seed"`
		FamilySequence    []string        `json:"familySequence"`
		Catalog           []WetlandFamily `json:"catalog"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.FixtureRevision != "wetland-stations-1" || fixture.SimulationVersion != WetlandSimulationVersion || fixture.GeneratorVersion != WetlandGeneratorVersion || fixture.ConfigID != WetlandDefaultConfigID {
		t.Fatalf("unexpected wetland fixture identity: %+v", fixture)
	}
	config := WetlandConfiguration()
	if len(config.Wetland.Families) != len(fixture.Catalog) {
		t.Fatal("catalog length differs from reviewed fixture")
	}
	for i, family := range config.Wetland.Families {
		want, _ := json.Marshal(fixture.Catalog[i])
		got, _ := json.Marshal(family)
		if string(got) != string(want) {
			t.Fatalf("catalog family %d differs: %s != %s", i, got, want)
		}
	}
	config.Pipes.Horizon = 10000000
	config.Limits.MaxActivePipes = 28
	config.Limits.MaxActiveCollectibles = 29
	config.StarSchedule = nil
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := Descriptor{RunID: "wetland-fixture", Seed: fixture.Seed, SimulationVersion: WetlandSimulationVersion, GeneratorVersion: WetlandGeneratorVersion, ConfigID: id}
	state, err := CreateRun(descriptor, config)
	if err != nil {
		t.Fatal(err)
	}
	var families []string
	for index := int64(0); index < int64(len(fixture.FamilySequence))*4; index++ {
		pipe := state.Pipes[index]
		family := config.Wetland.Families[0]
		for _, candidate := range config.Wetland.Families {
			if candidate.ID == pipe.EncounterFamily {
				family = candidate
				break
			}
		}
		step := *pipe.StationStep
		if pipe.GapCenter != family.GapCenters[step] || len(pipe.Obstacles) == 0 || pipe.Obstacles[0].TypeID != family.ObstacleTypes[step] {
			t.Fatalf("station %d geometry differs from catalog", index)
		}
		wantSpacing := family.StationSpacing[step]
		block := pipe.Index / 4
		if pipe.EncounterFamily == "steady" && block >= 2 && block%2 == 1 {
			wantSpacing = config.Wetland.RecoverySpacing
		}
		if pipe.StationSpacing == nil || *pipe.StationSpacing != wantSpacing {
			t.Fatalf("station %d spacing = %v, want %d", index, pipe.StationSpacing, wantSpacing)
		}
		if step == 0 {
			families = append(families, pipe.EncounterFamily)
		}
	}
	if len(families) != len(fixture.FamilySequence) {
		t.Fatal("incomplete family sequence")
	}
	for i, family := range families {
		if family != fixture.FamilySequence[i] {
			t.Fatalf("family %d = %s, want %s", i, family, fixture.FamilySequence[i])
		}
	}
	for i := 2; i < len(families); i += 2 {
		if families[i] == families[i-2] {
			t.Fatalf("pressure family repeated at block %d", i)
		}
	}
	state.Pipes = []Pipe{}
	nextX := int64(9500000)
	state.NextPipeX = &nextX
	state.NextPipeIndex = 28
	refilled, err := GenerateNext(state)
	if err != nil {
		t.Fatal(err)
	}
	if len(refilled.State.Pipes) == 0 || refilled.State.Pipes[0].Index != 28 || refilled.State.Pipes[0].X != nextX {
		t.Fatalf("pruned refill restarted: %+v", refilled.State.Pipes)
	}
}

func TestReviewedVariedWetlandFixture(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/wetland-v2.json"); err != nil {
		t.Fatal(err)
	}
}

func TestWetlandObstacleRectanglesAreLethal(t *testing.T) {
	config := WetlandConfiguration()
	config.StarSchedule = nil
	config.Pipes.Horizon = 3000000
	config.Limits.MaxActivePipes = 8
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := Descriptor{RunID: "wetland-collision", Seed: 9, SimulationVersion: WetlandSimulationVersion, GeneratorVersion: WetlandGeneratorVersion, ConfigID: id}
	initial, err := CreateRun(descriptor, config)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, pipe := range initial.Pipes {
		for _, obstacle := range pipe.Obstacles {
			if seen[obstacle.TypeID] {
				continue
			}
			seen[obstacle.TypeID] = true
			state := cloneState(initial)
			state.Phase = Running
			state.Duck.Y = obstacle.Y + obstacle.Height/2
			state.Duck.VY = 0
			state.Pipes = []Pipe{pipe}
			state.Pipes[0].X = state.Duck.X
			state.Pipes[0].Obstacles = []ObstacleDefinition{obstacle}
			result, stepErr := Step(state, nil)
			if stepErr != nil {
				t.Fatalf("%s step: %v", obstacle.TypeID, stepErr)
			}
			if result.State.Phase != Dead {
				t.Errorf("%s rectangle did not collide", obstacle.TypeID)
			}
		}
	}
	for _, typeID := range []string{"pipes", "vine", "rock", "debris"} {
		if !seen[typeID] {
			t.Errorf("missing obstacle type %s", typeID)
		}
	}
	pairedPipes := false
	for _, pipe := range initial.Pipes {
		if len(pipe.Obstacles) > 0 && pipe.Obstacles[0].TypeID == "pipes" {
			if len(pipe.Obstacles) != 2 {
				t.Fatalf("paired pipes have %d rectangles, want two", len(pipe.Obstacles))
			}
			pairedPipes = true
			break
		}
	}
	if !pairedPipes {
		t.Fatal("catalog did not generate paired pipes")
	}
}

func TestWetlandTrailsSpawnWholeAndStable(t *testing.T) {
	config := WetlandConfiguration()
	config.StarSchedule = nil
	config.Pipes.Horizon = 4000000
	config.Limits.MaxActivePipes = 12
	config.Limits.MaxActiveCollectibles = 13
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "wetland-trails", Seed: 11, SimulationVersion: WetlandSimulationVersion, GeneratorVersion: WetlandGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase = Running
	result, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"feather-trail-0-1", "feather-trail-0-3", "feather-trail-1-0", "feather-trail-1-1", "feather-trail-1-2", "feather-trail-1-3", "feather-trail-2-0", "feather-trail-2-1", "feather-trail-2-2", "feather-trail-2-3"}
	if len(result.State.Collectibles) != len(want) {
		t.Fatalf("spawned %d rewards, want complete ten-item route", len(result.State.Collectibles))
	}
	for i, collectible := range result.State.Collectibles {
		if collectible.ID != want[i] || collectible.TypeID != "FEATHER" || collectible.Amount != 1 {
			t.Errorf("reward %d = %+v, want ID %s one FEATHER", i, collectible, want[i])
		}
	}
}

func TestWetlandStarCapacityReservesWholeTrail(t *testing.T) {
	config := WetlandConfiguration()
	config.Pipes.Horizon = 1700000
	config.Limits.MaxActivePipes, config.Limits.MaxActiveCollectibles = 8, 10
	config.StarSchedule = &StarSchedule{MinIntervalPipes: 8, MaxIntervalPipes: 8}
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "wetland-star-route", Seed: 11, SimulationVersion: WetlandSimulationVersion, GeneratorVersion: WetlandGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase = Running
	ordinal := int64(0)
	state.NextStarPipeIndex, state.StarScheduleOrdinal = 1, &ordinal
	result, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	stars, feathers := 0, 0
	for _, item := range result.State.Collectibles {
		if item.TypeID == "GAME_STAR" && item.ID == "star-1" {
			stars++
		}
		if item.TypeID == "FEATHER" {
			feathers++
		}
	}
	if stars != 1 || feathers != 3 || int64(len(result.State.Collectibles)) > config.Limits.MaxActiveCollectibles {
		t.Fatalf("star route was dropped or exceeded reserve: stars=%d feathers=%d items=%d", stars, feathers, len(result.State.Collectibles))
	}
}

func TestValidateConfigRejectsNumbersOutsideJavaScriptSafeIntegerDomain(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"limit":   func(c *Config) { c.Limits.MaxActivePipes = 1 << 53 },
		"amount":  func(c *Config) { c.Collectibles[0].Amount = 1 << 53 },
		"version": func(c *Config) { c.Collectibles[0].Version = 1 << 53 },
	} {
		t.Run(name, func(t *testing.T) {
			c := PriorDefaultConfiguration()
			mutate(&c)
			if err := ValidateConfig(c); err == nil {
				t.Fatal("accepted unsafe integer")
			}
		})
	}
}

func TestValidateConfigRejectsInt64MinValue(t *testing.T) {
	config := PriorDefaultConfiguration()
	config.Flight.DuckX = -1 << 63
	if err := ValidateConfig(config); err == nil {
		t.Fatal("ValidateConfig accepted MinInt64")
	}
}

func TestCanonicalJSONRejectsNonSafeOrFractionalNumbers(t *testing.T) {
	for _, value := range []any{int64(9007199254740992), json.Number("1.5"), json.Number("1e2")} {
		if got, err := CanonicalJSON(value); err == nil {
			t.Errorf("CanonicalJSON(%v) = %q, want rejection", value, got)
		}
	}
	if got, err := CanonicalJSON(int64(9007199254740991)); err != nil || got != "9007199254740991" {
		t.Fatalf("safe boundary: got %q, %v", got, err)
	}
}

func TestRunEndedTotalsPresentAndIndependentFromState(t *testing.T) {
	config := PriorDefaultConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	s, err := CreateRun(Descriptor{"totals-test", 1, PriorSimulationVersion, PriorGeneratorVersion, id}, config)
	if err != nil {
		t.Fatal(err)
	}
	s.Phase, s.Duck.Y, s.Duck.VY = Running, 0, 0
	r, err := Step(s, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(r.Events)
	if err != nil {
		t.Fatal(err)
	}
	var events []map[string]json.RawMessage
	if err = json.Unmarshal(b, &events); err != nil {
		t.Fatal(err)
	}
	if _, ok := events[len(events)-1]["totals"]; !ok || string(events[len(events)-1]["totals"]) != "{}" {
		t.Fatalf("RunEnded totals must be present as {}, got %s", b)
	}
	r.Events[len(r.Events)-1].Totals["mutated"] = 1
	if _, ok := r.State.Totals["mutated"]; ok {
		t.Fatal("RunEnded totals alias returned state totals")
	}
}

func TestGenerateNextKeepsInputAndResultIndependent(t *testing.T) {
	input := foundationRun(t, PriorDefaultConfiguration())
	result, err := GenerateNext(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(input.Pipes) == 0 || len(result.State.Pipes) == 0 {
		t.Fatal("expected generated pipes")
	}

	result.State.Pipes[0].X++
	result.State.Config.Challenges.Families[0].GapCenters[0]++
	resultPipeX := result.State.Pipes[0].X
	resultGap := result.State.Config.Challenges.Families[0].GapCenters[0]
	if input.Pipes[0].X == result.State.Pipes[0].X ||
		input.Config.Challenges.Families[0].GapCenters[0] == result.State.Config.Challenges.Families[0].GapCenters[0] {
		t.Fatal("GenerateNext result aliases input state")
	}

	input.Pipes[0].X++
	input.Config.Challenges.Families[0].GapCenters[0]++
	if result.State.Pipes[0].X != resultPipeX ||
		result.State.Config.Challenges.Families[0].GapCenters[0] != resultGap {
		t.Fatal("GenerateNext input mutation changed returned state")
	}
}

func TestFixtureHarnessComparesEventsToRawJSON(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/golden-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatal(err)
	}
	var cases []map[string]json.RawMessage
	if err := json.Unmarshal(root["cases"], &cases); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, fixtureCase := range cases {
		var ops []map[string]json.RawMessage
		if err := json.Unmarshal(fixtureCase["operations"], &ops); err != nil {
			t.Fatal(err)
		}
		for _, op := range ops {
			var expected []map[string]json.RawMessage
			if err := json.Unmarshal(op["expectedEvents"], &expected); err != nil {
				continue
			}
			for _, event := range expected {
				if string(event["type"]) == `"RunEnded"` {
					delete(event, "totals")
					op["expectedEvents"], _ = json.Marshal(expected)
					fixtureCase["operations"], _ = json.Marshal(ops)
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("fixture has no RunEnded event")
	}
	root["cases"], _ = json.Marshal(cases)
	mutated, _ := json.Marshal(root)
	path := t.TempDir() + "/fixture.json"
	if err := os.WriteFile(path, mutated, 0600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyFoundationFixtures(path); err == nil {
		t.Fatal("harness accepted RunEnded fixture missing required totals")
	}
}
