package simulation

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestCurrentContractIdentity(t *testing.T) {
	if SimulationVersion != "3.1.0" || GeneratorVersion != "3.1.0" || DefaultConfigID != "dd-v3-varied-base-v1" {
		t.Fatalf("unexpected bonus-segments-v2 identity: %s/%s/%s", SimulationVersion, GeneratorVersion, DefaultConfigID)
	}
	current, err := CreateRun(Descriptor{RunID: "current", Seed: 4, SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: DefaultConfigID})
	if err != nil || current.Config.Wetland == nil || current.Config.Wetland.CatalogVersion != 12 || current.NextPipeX == nil || current.Config.Wetland.StarFormations == nil || *current.Config.Wetland.StarFormations {
		t.Fatalf("bonus-segments-v2 default run missing catalog/cursor/default Star policy: err=%v", err)
	}
	bonusSegmentsV1, err := CreateRun(Descriptor{RunID: "bonus-v1-frozen", Seed: 4, SimulationVersion: BonusSegmentsSimulationVersion, GeneratorVersion: BonusSegmentsGeneratorVersion, ConfigID: BonusSegmentsConfigID})
	if err != nil || bonusSegmentsV1.Config.Wetland == nil || bonusSegmentsV1.Config.Wetland.CatalogVersion != 6 {
		t.Fatalf("frozen catalog-6 bonus-segments identity is unavailable: err=%v", err)
	}
	coinCourse, err := CreateRun(Descriptor{RunID: "coin-course-frozen", Seed: 4, SimulationVersion: CoinCourseSimulationVersion, GeneratorVersion: CoinCourseGeneratorVersion, ConfigID: CoinCourseConfigID})
	if err != nil || coinCourse.Config.Wetland == nil || coinCourse.Config.Wetland.CatalogVersion != 5 {
		t.Fatalf("frozen coin-course identity is unavailable: err=%v", err)
	}
	frozenCurrency, err := CreateRun(Descriptor{RunID: "currency-frozen", Seed: 4, SimulationVersion: CurrencyFormationsSimulationVersion, GeneratorVersion: CurrencyFormationsGeneratorVersion, ConfigID: CurrencyFormationsConfigID})
	if err != nil || frozenCurrency.Config.Wetland == nil || frozenCurrency.Config.Wetland.CatalogVersion != 4 {
		t.Fatalf("frozen currency-formation identity is unavailable: err=%v", err)
	}
	paired, err := CreateRun(Descriptor{RunID: "paired-frozen", Seed: 4, SimulationVersion: PairedRoutesSimulationVersion, GeneratorVersion: PairedRoutesGeneratorVersion, ConfigID: PairedRoutesConfigID})
	if err != nil || paired.Config.Wetland == nil || paired.Config.Wetland.CatalogVersion != 3 {
		t.Fatalf("frozen paired-routes identity is unavailable: err=%v", err)
	}
	if current.Config.Wetland.StarRoute != (WetlandRewardPoint{XOffset: 100000, YOffset: 35000}) {
		t.Fatalf("paired-routes Star route=%+v, want paired offset 100000/35000", current.Config.Wetland.StarRoute)
	}
	for _, pipe := range current.Pipes {
		if len(pipe.Obstacles) != 2 || pipe.Obstacles[0].TypeID != "pipes" || pipe.Obstacles[1].TypeID != "pipes" || pipe.Obstacles[0].Height <= 0 || pipe.Obstacles[1].Height <= 0 {
			t.Fatalf("paired default produced invalid obstacle geometry: %+v", pipe.Obstacles)
		}
	}
	varied, err := CreateRun(Descriptor{RunID: "varied", Seed: 4, SimulationVersion: VariedObstacleSimulationVersion, GeneratorVersion: VariedObstacleGeneratorVersion, ConfigID: VariedObstacleDefaultConfigID})
	if err != nil || varied.Config.Wetland == nil || varied.Config.Wetland.CatalogVersion != 2 {
		t.Fatalf("frozen varied-obstacle identity is unavailable: err=%v", err)
	}
	legacyWetland, err := CreateRun(Descriptor{RunID: "wetland-v2", Seed: 4, SimulationVersion: WetlandSimulationVersion, GeneratorVersion: WetlandGeneratorVersion, ConfigID: WetlandDefaultConfigID})
	if err != nil || legacyWetland.Config.Wetland == nil || legacyWetland.Config.Wetland.CatalogVersion != 1 {
		t.Fatalf("frozen wetland v2 identity is unavailable: err=%v", err)
	}
	if legacyWetland.Config.Wetland.StarRoute != (WetlandRewardPoint{XOffset: 100000, YOffset: 70000}) {
		t.Fatalf("frozen catalog-1 Star route changed: %+v", legacyWetland.Config.Wetland.StarRoute)
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

func TestCreateRunResolvesFrozenCurrencyDescriptorWithoutExplicitConfig(t *testing.T) {
	state, err := CreateRun(Descriptor{
		RunID:             "currency-descriptor-only",
		Seed:              17,
		SimulationVersion: CurrencyFormationsSimulationVersion,
		GeneratorVersion:  CurrencyFormationsGeneratorVersion,
		ConfigID:          CurrencyFormationsConfigID,
	})
	if err != nil {
		t.Fatalf("CreateRun rejected frozen currency descriptor without explicit config: %v", err)
	}
	if state.Config.Wetland == nil || state.Config.Wetland.CatalogVersion != 4 {
		t.Fatalf("descriptor resolved catalog %v, want 4", state.Config.Wetland)
	}
	configID, err := ConfigIDFor(state.Config)
	if err != nil || configID != CurrencyFormationsConfigID {
		t.Fatalf("descriptor resolved config id=%q, err=%v; want %q", configID, err, CurrencyFormationsConfigID)
	}
}

func TestCatalogVersionAndDescriptorPairBinding(t *testing.T) {
	config := VariedObstacleConfiguration()
	config.Pipes.Width++
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := Descriptor{RunID: "catalog-2-custom", Seed: 1, SimulationVersion: VariedObstacleSimulationVersion, GeneratorVersion: VariedObstacleGeneratorVersion, ConfigID: id}
	if _, err := CreateRun(descriptor, config); err != nil {
		t.Fatalf("catalog-2 custom config rejected under current pair: %v", err)
	}
	for _, pair := range [][2]string{{SimulationVersion, GeneratorVersion}, {WetlandSimulationVersion, WetlandGeneratorVersion}, {PriorSimulationVersion, PriorGeneratorVersion}, {LegacySimulationVersion, LegacyGeneratorVersion}} {
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
	for _, pair := range [][2]string{{SimulationVersion, GeneratorVersion}, {VariedObstacleSimulationVersion, VariedObstacleGeneratorVersion}, {WetlandSimulationVersion, WetlandGeneratorVersion}, {PriorSimulationVersion, PriorGeneratorVersion}, {LegacySimulationVersion, LegacyGeneratorVersion}} {
		legacyDescriptor.SimulationVersion, legacyDescriptor.GeneratorVersion = pair[0], pair[1]
		if _, err := CreateRun(legacyDescriptor, legacy); err != nil {
			t.Errorf("catalog-1 custom run rejected under formerly accepted pair %s/%s: %v", pair[0], pair[1], err)
		}
	}
}

func TestCatalogThreeAcceptsPairedRoutesAndRejectsMixedObstacles(t *testing.T) {
	config := PairedRoutesConfiguration()
	for _, family := range config.Wetland.Families {
		for _, typeID := range family.ObstacleTypes {
			if typeID != "pipes" {
				t.Fatalf("test config still has non-pipe obstacle %q", typeID)
			}
		}
	}
	if err := ValidateConfig(config); err != nil {
		t.Fatalf("catalog-3 paired routes rejected: %v", err)
	}
	if config.Wetland.StarRoute != (WetlandRewardPoint{XOffset: 100000, YOffset: 35000}) {
		t.Fatalf("catalog-3 Star route=%+v, want paired offset 100000/35000", config.Wetland.StarRoute)
	}
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CreateRun(Descriptor{RunID: "catalog-3-paired", Seed: 3, SimulationVersion: PairedRoutesSimulationVersion, GeneratorVersion: PairedRoutesGeneratorVersion, ConfigID: id}); err != nil {
		t.Fatalf("catalog-3 default-pair run rejected: %v", err)
	}
	mixed := cloneConfig(config)
	mixed.Wetland.Families[0].ObstacleTypes[1] = "vine"
	if err := ValidateConfig(mixed); err == nil {
		t.Fatal("catalog-3 mixed obstacle family accepted")
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
			descriptor := Descriptor{RunID: "shifted-recovery", Seed: int64(testCase.seed), SimulationVersion: VariedObstacleSimulationVersion, GeneratorVersion: VariedObstacleGeneratorVersion, ConfigID: id}
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

func TestCoinCourseRawFullStateAndEventFixtureParity(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/coin-course-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestWetlandStepAdvancesSpawnCursorAfterEveryStationWasPruned(t *testing.T) {
	config := CurrencyFormationsConfiguration()
	state, err := CreateRun(Descriptor{RunID: "wetland-refill", Seed: 32, SimulationVersion: CurrencyFormationsSimulationVersion, GeneratorVersion: CurrencyFormationsGeneratorVersion, ConfigID: CurrencyFormationsConfigID}, config)
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

func TestReviewedPairedRoutesFixture(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/wetland-v3.json"); err != nil {
		t.Fatal(err)
	}
}

func TestReviewedCurrencyFormationsFixture(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/currency-formations-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestReviewedBonusSegmentsFixture(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/bonus-segments-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestReviewedBonusSegmentsRecoveryFixture(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/bonus-segments-recovery-v1.json"); err != nil {
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

func TestPairedRoutesRewardLifecycleAndCapacity(t *testing.T) {
	config := PairedRoutesConfiguration()
	config.Pipes.Horizon = 4000000
	config.Limits.MaxActivePipes, config.Limits.MaxActiveCollectibles = 12, 13
	config.StarSchedule = nil
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "paired-trails", Seed: 11, SimulationVersion: PairedRoutesSimulationVersion, GeneratorVersion: PairedRoutesGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase = Running
	spawned, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"feather-trail-0-1", "feather-trail-0-3", "feather-trail-1-0", "feather-trail-1-1", "feather-trail-1-2", "feather-trail-1-3", "feather-trail-2-0", "feather-trail-2-1", "feather-trail-2-2", "feather-trail-2-3"}
	if len(spawned.State.Collectibles) != len(want) {
		t.Fatalf("paired run spawned %d rewards, want complete ten-item route", len(spawned.State.Collectibles))
	}
	seen := map[string]bool{}
	for i, collectible := range spawned.State.Collectibles {
		if collectible.ID != want[i] || collectible.TypeID != "FEATHER" || collectible.Amount != 1 || seen[collectible.ID] {
			t.Errorf("paired reward %d = %+v, want unique ID %s and one FEATHER", i, collectible, want[i])
		}
		seen[collectible.ID] = true
	}

	config.Pipes.Horizon = 1700000
	config.Limits.MaxActivePipes, config.Limits.MaxActiveCollectibles = 8, 10
	config.StarSchedule = &StarSchedule{MinIntervalPipes: 8, MaxIntervalPipes: 8}
	id, err = ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	starState, err := CreateRun(Descriptor{RunID: "paired-star-route", Seed: 11, SimulationVersion: PairedRoutesSimulationVersion, GeneratorVersion: PairedRoutesGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	starState.Phase = Running
	ordinal := int64(0)
	starState.NextStarPipeIndex, starState.StarScheduleOrdinal = 1, &ordinal
	starred, err := Step(starState, nil)
	if err != nil {
		t.Fatal(err)
	}
	stars, feathers := 0, 0
	seen = map[string]bool{}
	for _, item := range starred.State.Collectibles {
		if seen[item.ID] {
			t.Errorf("duplicate collectible ID %q", item.ID)
		}
		seen[item.ID] = true
		if item.TypeID == "GAME_STAR" && item.ID == "star-1" {
			stars++
		}
		if item.TypeID == "FEATHER" {
			feathers++
		}
	}
	if stars != 1 || feathers != 3 || int64(len(starred.State.Collectibles)) > config.Limits.MaxActiveCollectibles {
		t.Fatalf("paired Star reserve dropped route or exceeded cap: stars=%d feathers=%d items=%d cap=%d", stars, feathers, len(starred.State.Collectibles), config.Limits.MaxActiveCollectibles)
	}
}

func TestCurrencyFormationsEmitIndividualMembersWithinCapacity(t *testing.T) {
	config := CurrencyFormationsConfiguration()
	config.Pipes.Horizon = 4000000
	config.StarSchedule = nil
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "formation-feathers", Seed: 11, SimulationVersion: CurrencyFormationsSimulationVersion, GeneratorVersion: CurrencyFormationsGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase = Running
	spawned, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	feathers := 0
	for _, item := range spawned.State.Collectibles {
		if seen[item.ID] {
			t.Fatalf("duplicate collectible ID %q", item.ID)
		}
		seen[item.ID] = true
		if item.TypeID == "FEATHER" {
			feathers++
			if item.Amount != 1 {
				t.Errorf("formation member amount=%d, want one", item.Amount)
			}
		}
	}
	if feathers < 3 || int64(len(spawned.State.Collectibles)) > config.Limits.MaxActiveCollectibles {
		t.Fatalf("feather formation count=%d total=%d cap=%d", feathers, len(spawned.State.Collectibles), config.Limits.MaxActiveCollectibles)
	}

	config.Pipes.Horizon = 1700000
	config.StarSchedule = &StarSchedule{MinIntervalPipes: 8, MaxIntervalPipes: 8}
	id, err = ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err = CreateRun(Descriptor{RunID: "formation-stars", Seed: 11, SimulationVersion: CurrencyFormationsSimulationVersion, GeneratorVersion: CurrencyFormationsGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase = Running
	state.NextStarPipeIndex = 1
	ordinal := int64(0)
	state.StarScheduleOrdinal = &ordinal
	starred, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	stars := 0
	for _, item := range starred.State.Collectibles {
		if item.TypeID == "GAME_STAR" {
			stars++
			if item.Amount != 1 || !strings.HasPrefix(item.ID, "star-1-") {
				t.Errorf("bad Star member %+v", item)
			}
		}
	}
	if stars != 5 || int64(len(starred.State.Collectibles)) > config.Limits.MaxActiveCollectibles {
		t.Fatalf("Star formation count=%d total=%d cap=%d", stars, len(starred.State.Collectibles), config.Limits.MaxActiveCollectibles)
	}
}

func TestCurrencyFormationGeometryAndSupportedBounds(t *testing.T) {
	config := CurrencyFormationsConfiguration()
	state, err := CreateRun(Descriptor{RunID: "formation-geometry", Seed: 1, SimulationVersion: CurrencyFormationsSimulationVersion, GeneratorVersion: CurrencyFormationsGeneratorVersion, ConfigID: CurrencyFormationsConfigID}, config)
	if err != nil {
		t.Fatal(err)
	}
	pipe := state.Pipes[1]
	featherRadius, starRadius := int64(0), int64(0)
	for _, definition := range config.Collectibles {
		if definition.TypeID == "FEATHER" {
			featherRadius = definition.Radius
		}
		if definition.TypeID == "GAME_STAR" {
			starRadius = definition.Radius
		}
	}
	coin := currencyFormationPoints(config, 1, pipe, featherRadius, false, pipe.Index)
	if len(coin) != 3 {
		t.Fatalf("coin formation has %d members", len(coin))
	}
	if coin[1][0] != coin[2][0] || coin[1][1] == coin[2][1] || coin[0][0] == coin[1][0] {
		t.Fatalf("three-member coin group is not a fish-like triangle: %v", coin)
	}
	cross := (coin[1][0]-coin[0][0])*(coin[2][1]-coin[0][1]) - (coin[2][0]-coin[0][0])*(coin[1][1]-coin[0][1])
	if cross == 0 {
		t.Fatalf("coin formation is collinear: %v", coin)
	}

	inspectStar := func(seed, eventOrdinal int64) (string, string) {
		points := currencyFormationPoints(config, uint32(seed), pipe, starRadius, true, eventOrdinal)
		var centerX, centerY int64
		for _, point := range points {
			if point[1]-starRadius-config.Flight.DuckHalfHeight <= pipe.GapCenter-config.Pipes.GapHeight/2 ||
				point[1]+starRadius+config.Flight.DuckHalfHeight >= pipe.GapCenter+config.Pipes.GapHeight/2 ||
				!(point[0]+starRadius+config.Flight.DuckHalfWidth < pipe.X || point[0]-starRadius-config.Flight.DuckHalfWidth > pipe.X+config.Pipes.Width) {
				t.Fatalf("Star member is not clear of its pipe or gap bounds: point=%v pipe=%+v", point, pipe)
			}
			centerX += point[0]
			centerY += point[1]
		}
		centerX /= int64(len(points))
		centerY /= int64(len(points))
		side := "inside"
		switch {
		case centerX < pipe.X:
			side = "left"
		case centerX > pipe.X+config.Pipes.Width:
			side = "right"
		}
		parts := make([]string, len(points))
		for i, point := range points {
			parts[i] = fmt.Sprintf("%d,%d", point[0]-centerX, point[1]-centerY)
		}
		return side, strings.Join(parts, ";")
	}
	for _, samples := range [][][2]int64{
		{{1, 0}, {2, 0}, {3, 0}, {4, 0}, {5, 0}, {6, 0}, {7, 0}, {8, 0}},
		{{1, 0}, {1, 1}, {1, 2}, {1, 3}, {1, 4}, {1, 5}, {1, 6}, {1, 7}},
	} {
		sides, orientations := map[string]bool{}, map[string]bool{}
		for _, sample := range samples {
			side, orientation := inspectStar(sample[0], sample[1])
			sides[side] = true
			orientations[orientation] = true
		}
		if len(sides) != 2 || !sides["left"] || !sides["right"] {
			t.Fatalf("scheduled Star obstacle sides did not vary across a single seed/event axis: %v", sides)
		}
		if len(orientations) < 2 {
			t.Fatalf("scheduled Star orientations did not vary across a single seed/event axis: %v", orientations)
		}
	}

	narrow := CurrencyFormationsConfiguration()
	narrow.Pipes.GapHeight = 60000
	if err := ValidateConfig(narrow); err == nil {
		t.Fatal("catalog-4 accepted a 60000-unit opening that cannot fit the Star formation")
	}
}

func TestCoinCourseFormationGeometryOnlyAppliesOnScheduledBlocks(t *testing.T) {
	courseConfig := CoinCourseConfiguration()
	catalog4Config := CurrencyFormationsConfiguration()
	seed := uint32(0)
	for ; seed < 256; seed++ {
		if isCoinCourseBlock(seed, 2) {
			break
		}
	}
	if seed == 256 {
		t.Fatal("no seed schedules the first coin course in block 2")
	}
	step := int64(2)
	makePipe := func(block int64) Pipe {
		return Pipe{Index: block*4 + step, X: 450000, GapCenter: 280000, StationStep: &step}
	}
	radius := int64(7000)

	ordinaryPipe := makePipe(3)
	if isCoinCourseBlock(seed, ordinaryPipe.Index/4) {
		t.Fatal("test ordinary block unexpectedly schedules a coin course")
	}
	ordinaryCourseConfig := currencyFormationPoints(courseConfig, seed, ordinaryPipe, radius, false, ordinaryPipe.Index)
	ordinaryCatalog4 := currencyFormationPoints(catalog4Config, seed, ordinaryPipe, radius, false, ordinaryPipe.Index)
	if fmt.Sprint(ordinaryCourseConfig) != fmt.Sprint(ordinaryCatalog4) {
		t.Fatalf("ordinary catalog-5 formation differs from catalog 4: course=%v catalog4=%v", ordinaryCourseConfig, ordinaryCatalog4)
	}

	coursePipe := makePipe(2)
	if !isCoinCourseBlock(seed, coursePipe.Index/4) {
		t.Fatal("test course block is not scheduled")
	}
	scheduled := currencyFormationPoints(courseConfig, seed, coursePipe, radius, false, coursePipe.Index)
	wantX := []int64{coursePipe.X + 70000, coursePipe.X + 100000, coursePipe.X + 130000}
	if len(scheduled) != len(wantX) {
		t.Fatalf("scheduled course formation has %d members, want %d", len(scheduled), len(wantX))
	}
	for index, point := range scheduled {
		if point[0] != wantX[index] {
			t.Fatalf("scheduled course member %d x=%d, want %d", index, point[0], wantX[index])
		}
	}
	if fmt.Sprint(scheduled) == fmt.Sprint(currencyFormationPoints(catalog4Config, seed, coursePipe, radius, false, coursePipe.Index)) {
		t.Fatal("scheduled course formation unexpectedly uses ordinary catalog-4 geometry")
	}
}

func TestBonusSegmentCatalogIdentitySchedulingGeometryAndStarOptIn(t *testing.T) {
	config := BonusSegmentsConfiguration()
	descriptor := Descriptor{RunID: "bonus-segment", Seed: 32, SimulationVersion: BonusSegmentsSimulationVersion, GeneratorVersion: BonusSegmentsGeneratorVersion, ConfigID: BonusSegmentsConfigID}
	state, err := CreateRun(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if state.Config.Wetland == nil || state.Config.Wetland.CatalogVersion != 6 || state.Config.Wetland.StarFormations == nil || *state.Config.Wetland.StarFormations {
		t.Fatalf("default config = %+v, want catalog-6 single-Star policy", state.Config.Wetland)
	}
	if id, err := ConfigIDFor(config); err != nil || id != BonusSegmentsConfigID {
		t.Fatalf("default identity = %q, err=%v", id, err)
	}

	seenRecipes := map[bonusSegmentRecipe]bool{}
	for seed := uint32(0); seed < 512; seed++ {
		for slot := int64(0); slot < 6; slot++ {
			first := int64(2) + slot*3
			selected := 0
			for block := first; block <= first+1; block++ {
				if isBonusSegmentBlock(seed, block) {
					selected++
					seenRecipes[getBonusSegmentRecipe(seed, block)] = true
				}
			}
			if selected != 1 || isBonusSegmentBlock(seed, first+2) {
				t.Fatalf("seed=%d slot=%d did not select exactly one block in its first pair", seed, slot)
			}
		}
	}
	if len(seenRecipes) != 3 {
		t.Fatalf("seed schedule exercised recipes %v, want all three", seenRecipes)
	}

	seed := uint32(0)
	for ; seed < 256; seed++ {
		if isBonusSegmentBlock(seed, 2) {
			break
		}
	}
	block := int64(2)
	start := int64(100000)
	state.NextPipeIndex = block * 4
	state.Pipes = []Pipe{}
	state.NextSpawnPipeIndex = state.NextPipeIndex
	state.NextPipeX = &start
	state.Descriptor.Seed = int64(seed)
	generated, err := GenerateNext(state)
	if err != nil {
		t.Fatal(err)
	}
	course := generated.State.Pipes
	if len(course) < 4 {
		t.Fatalf("generated %d stations for course block", len(course))
	}
	for _, pipe := range course[:4] {
		step := *pipe.StationStep
		family := generated.State.Config.Wetland.Families[0]
		for _, candidate := range generated.State.Config.Wetland.Families {
			if candidate.ID == pipe.EncounterFamily {
				family = candidate
				break
			}
		}
		original := family.StationSpacing[step]
		if pipe.EncounterFamily == "steady" && pipe.Index/4 >= 2 {
			original = generated.State.Config.Wetland.RecoverySpacing
		}
		want := scaledClearanceSpacing(original, generated.State.Config.Pipes.Width, 70)
		if step < 2 {
			want = scaledClearanceSpacing(original, generated.State.Config.Pipes.Width, 20)
		} else if step == 2 {
			want = generated.State.Config.Pipes.Width + bonusSegmentRecovery
		}
		if *pipe.StationSpacing != want {
			t.Fatalf("course station %d spacing=%d want=%d", step, *pipe.StationSpacing, want)
		}
	}
	ordinaryBlock := int64(3)
	if isBonusSegmentBlock(seed, ordinaryBlock) {
		ordinaryBlock = 4
	}
	ordinaryState := state
	ordinaryState.NextPipeIndex = ordinaryBlock * 4
	ordinaryState.NextSpawnPipeIndex = ordinaryState.NextPipeIndex
	ordinary, err := GenerateNext(ordinaryState)
	if err != nil {
		t.Fatal(err)
	}
	ordinaryStep2 := ordinary.State.Pipes[2]
	radius := int64(7000)
	if points := currencyFormationPoints(config, seed, ordinaryStep2, radius, false, ordinaryStep2.Index); len(points) != 1 {
		t.Fatalf("ordinary catalog-6 station-2 returned %d coins, want one", len(points))
	}
	coursePipe := course[2]
	points := currencyFormationPoints(config, seed, coursePipe, radius, false, coursePipe.Index)
	centerX := coursePipe.X + *coursePipe.StationSpacing/2
	if len(points) != 3 || points[0][0] != centerX-18000 || points[1][0] != centerX+9000 || points[2][0] != centerX+9000 {
		t.Fatalf("course figure=%v, expected three members centered at %d", points, centerX)
	}

	starPoints := currencyFormationPoints(config, seed, course[0], radius, true, 0)
	if len(starPoints) != 1 || starPoints[0][0] != course[0].X+config.Pipes.Width/2 {
		t.Fatalf("default Star layout = %v, want one in-opening pickup", starPoints)
	}
	enabled := true
	formed := config
	formed.Wetland = cloneConfig(config).Wetland
	formed.Wetland.StarFormations = &enabled
	if err := ValidateConfig(formed); err != nil {
		t.Fatalf("catalog-6 Star opt-in rejected: %v", err)
	}

	withoutSchedule := cloneConfig(config)
	withoutSchedule.StarSchedule = nil
	disabled := false
	withoutSchedule.Wetland.StarFormations = &disabled
	if err := ValidateConfig(withoutSchedule); err != nil {
		t.Fatalf("catalog-6 explicit Star opt-out without schedule rejected: %v", err)
	}
	withoutSchedule.Wetland.StarFormations = &enabled
	if err := ValidateConfig(withoutSchedule); err == nil {
		t.Fatal("catalog-6 Star opt-in without schedule accepted")
	}

	if id, err := ConfigIDFor(formed); err != nil || id == BonusSegmentsConfigID {
		t.Fatalf("custom Star policy identity=%q, err=%v", id, err)
	}
	if points := currencyFormationPoints(formed, seed, course[0], radius, true, 0); len(points) != 5 {
		t.Fatalf("opt-in Star layout has %d members, want 5", len(points))
	}
	old := CoinCourseConfiguration()
	old.Wetland.StarFormations = &enabled
	if err := ValidateConfig(old); err == nil {
		t.Fatal("catalog-5 accepted catalog-6 Star formation option")
	}

	repeatDescriptor := Descriptor{RunID: "bonus-repeat", Seed: int64(seed), SimulationVersion: BonusSegmentsSimulationVersion, GeneratorVersion: BonusSegmentsGeneratorVersion, ConfigID: BonusSegmentsConfigID}
	firstCourse, err := CreateRun(repeatDescriptor)
	if err != nil {
		t.Fatal(err)
	}
	repeatedCourse, err := CreateRun(repeatDescriptor)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := CanonicalJSON(firstCourse.Pipes); got != mustCanonicalJSON(t, repeatedCourse.Pipes) {
		t.Fatal("repeated default run produced different initial pipe geometry")
	}
}

func TestBonusSegmentPickupRulesRestoreNormalDropsAndReserveCourseFigure(t *testing.T) {
	seed := uint32(0)
	for ; seed < 2048; seed++ {
		state, err := CreateRun(Descriptor{RunID: "bonus-normal-drop", Seed: int64(seed), SimulationVersion: BonusSegmentsSimulationVersion, GeneratorVersion: BonusSegmentsGeneratorVersion, ConfigID: BonusSegmentsConfigID})
		if err != nil {
			t.Fatal(err)
		}
		state.Phase = Running
		result, err := Step(state, nil)
		if err != nil {
			t.Fatal(err)
		}
		feathers := 0
		for _, item := range result.State.Collectibles {
			if item.TypeID == "FEATHER" {
				feathers++
				if item.ID != "collectible-1" || item.Amount != 1 {
					t.Fatalf("ordinary drop=%+v, want one normal FEATHER pickup", item)
				}
			}
		}
		if feathers == 1 {
			break
		}
	}
	if seed == 2048 {
		t.Fatal("no seed produced an ordinary FEATHER pickup in the first normal block")
	}

	courseSeed := uint32(0)
	for ; courseSeed < 256 && !isBonusSegmentBlock(courseSeed, 2); courseSeed++ {
	}
	state, err := CreateRun(Descriptor{RunID: "bonus-course-drop", Seed: int64(courseSeed), SimulationVersion: BonusSegmentsSimulationVersion, GeneratorVersion: BonusSegmentsGeneratorVersion, ConfigID: BonusSegmentsConfigID})
	if err != nil {
		t.Fatal(err)
	}
	state.Pipes = []Pipe{}
	state.NextPipeIndex, state.NextSpawnPipeIndex = 8, 8
	start := int64(100000)
	state.NextPipeX = &start
	state.LastGapCenter = 280000
	state.Phase = Running
	generated, err := GenerateNext(state)
	if err != nil {
		t.Fatal(err)
	}
	result, err := Step(generated.State, nil)
	if err != nil {
		t.Fatal(err)
	}
	figure := 0
	for _, item := range result.State.Collectibles {
		if strings.HasPrefix(item.ID, "bonus-segment-2-") {
			figure++
			if item.TypeID != "FEATHER" || item.Amount != 1 {
				t.Fatalf("course figure member=%+v", item)
			}
		}
	}
	if figure != 3 {
		t.Fatalf("scheduled course produced %d figure members, want 3", figure)
	}
}

func TestBonusSegmentV2CatalogVectorsAndValidation(t *testing.T) {
	defaultConfig := BonusSegmentsV2Configuration()
	if id, err := ConfigIDFor(defaultConfig); err != nil || id != BonusSegmentsV2ConfigID {
		t.Fatalf("catalog-7 identity=%q err=%v", id, err)
	}
	if defaultConfig.Wetland.CatalogVersion != 7 || defaultConfig.Wetland.StarFormations == nil || *defaultConfig.Wetland.StarFormations {
		t.Fatalf("catalog-7 default=%+v, want default-off Star formations", defaultConfig.Wetland)
	}
	if id, err := ConfigIDFor(BonusSegmentsConfiguration()); err != nil || id != BonusSegmentsConfigID {
		t.Fatalf("catalog-6 frozen identity=%q err=%v", id, err)
	}

	withoutSchedule := cloneConfig(defaultConfig)
	withoutSchedule.StarSchedule = nil
	disabled := false
	withoutSchedule.Wetland.StarFormations = &disabled
	if err := ValidateConfig(withoutSchedule); err != nil {
		t.Fatalf("catalog-7 Star opt-out without schedule rejected: %v", err)
	}
	enabled := true
	withoutSchedule.Wetland.StarFormations = &enabled
	if err := ValidateConfig(withoutSchedule); err == nil {
		t.Fatal("catalog-7 Star opt-in without schedule accepted")
	}

	vectors := []struct {
		seed    uint32
		block   int64
		recipe  string
		centers [4]int64
		spacing [4]int64
	}{
		{0, 3, "slalom", [4]int64{263974, 223974, 303974, 346348}, [4]int64{82800, 82800, 412000, 206000}},
		{1, 2, "slalom", [4]int64{294789, 334789, 254789, 289573}, [4]int64{76800, 82800, 412000, 146000}},
		{2, 3, "descent", [4]int64{265395, 305395, 345395, 338454}, [4]int64{82800, 82800, 412000, 206000}},
		{19, 2, "descent", [4]int64{299325, 259325, 219325, 197958}, [4]int64{76800, 82800, 412000, 146000}},
		{31, 3, "ascent", [4]int64{289018, 329018, 369018, 382304}, [4]int64{82800, 82800, 412000, 206000}},
		{128, 2, "slalom", [4]int64{275782, 235782, 315782, 305790}, [4]int64{76800, 82800, 412000, 146000}},
	}
	for _, vector := range vectors {
		if got := bonusSegmentV2Recipe(vector.seed, vector.block); got != vector.recipe {
			t.Fatalf("seed=%d block=%d recipe=%s want=%s", vector.seed, vector.block, got, vector.recipe)
		}
		descriptor := Descriptor{RunID: "catalog-7-vector", Seed: int64(vector.seed), SimulationVersion: BonusSegmentsV2SimulationVersion, GeneratorVersion: BonusSegmentsV2GeneratorVersion, ConfigID: BonusSegmentsV2ConfigID}
		state, err := CreateRun(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		state.Pipes = []Pipe{}
		state.NextPipeIndex, state.NextSpawnPipeIndex = vector.block*4, vector.block*4
		start := int64(100000)
		state.NextPipeX = &start
		state.LastGapCenter = 280000
		generated, err := GenerateNext(state)
		if err != nil {
			t.Fatalf("seed=%d block=%d: %v", vector.seed, vector.block, err)
		}
		if len(generated.State.Pipes) < 4 {
			t.Fatalf("seed=%d block=%d generated %d stations", vector.seed, vector.block, len(generated.State.Pipes))
		}
		for station, pipe := range generated.State.Pipes[:4] {
			if pipe.GapCenter != vector.centers[station] || pipe.StationSpacing == nil || *pipe.StationSpacing != vector.spacing[station] {
				t.Fatalf("seed=%d block=%d station=%d center/spacing=%d/%v want=%d/%d", vector.seed, vector.block, station, pipe.GapCenter, pipe.StationSpacing, vector.centers[station], vector.spacing[station])
			}
		}
	}

	// Ordinary post-intro centers use an indexed hash, so generation can be
	// repeated or resumed without consuming mutable RNG state.
	ordinaryBlock := int64(2)
	for isBonusSegmentBlock(77, ordinaryBlock) {
		ordinaryBlock++
	}
	ordinaryCenters := make(map[int64]bool)
	for seed := uint32(1); seed <= 64; seed++ {
		state, err := CreateRun(Descriptor{RunID: "ordinary-center", Seed: int64(seed), SimulationVersion: BonusSegmentsV2SimulationVersion, GeneratorVersion: BonusSegmentsV2GeneratorVersion, ConfigID: BonusSegmentsV2ConfigID})
		if err != nil {
			t.Fatal(err)
		}
		previous := int64(280000)
		first := bonusSegmentV2OrdinaryCenter(seed, ordinaryBlock*4, previous, state.Config)
		repeated := bonusSegmentV2OrdinaryCenter(seed, ordinaryBlock*4, previous, state.Config)
		if first != repeated || first < previous-45000 || first > previous+45000 {
			t.Fatalf("seed=%d ordinary center=%d repeated=%d outside +/-45k", seed, first, repeated)
		}
		ordinaryCenters[first] = true
	}
	if len(ordinaryCenters) < 50 {
		t.Fatalf("ordinary center hash produced only %d distinct centers across 64 seeds", len(ordinaryCenters))
	}

	courseSeed := uint32(0)
	for ; courseSeed < 1024 && !isBonusSegmentBlock(courseSeed, 2); courseSeed++ {
	}
	if courseSeed == 1024 {
		t.Fatal("no seed scheduled a bonus segment in block 2")
	}
	courseConfig := BonusSegmentsV2Configuration()
	stationStep := int64(2)
	stationSpacing := courseConfig.Pipes.Width + bonusSegmentRecovery
	coursePipe := Pipe{Index: 2*4 + 2, X: 100000, GapCenter: 280000, StationStep: &stationStep, StationSpacing: &stationSpacing}
	courseFigure := currencyFormationPoints(courseConfig, courseSeed, coursePipe, 7000, false, coursePipe.Index)
	if len(courseFigure) != 3 {
		t.Fatalf("scheduled catalog-7 course layout has %d coins, want 3", len(courseFigure))
	}
	ordinaryPipe := coursePipe
	ordinaryPipe.Index = 3*4 + 2
	ordinaryFigure := currencyFormationPoints(courseConfig, courseSeed, ordinaryPipe, 7000, false, ordinaryPipe.Index)
	if len(ordinaryFigure) != 1 {
		t.Fatalf("ordinary catalog-7 station-2 layout has %d coins, want one", len(ordinaryFigure))
	}
	star := currencyFormationPoints(courseConfig, courseSeed, coursePipe, 4000, true, coursePipe.Index)
	if len(star) != 1 {
		t.Fatalf("catalog-7 default Star layout has %d members, want one", len(star))
	}
}

func TestBonusSegmentV2RequiresFullRouteGeometry(t *testing.T) {
	minimumRange := BonusSegmentsV2Configuration()
	minimumRange.Pipes.GapMinCenter, minimumRange.Pipes.GapMaxCenter = 240000, 320000
	minimumRange.Pipes.MaxGapDelta = 80000
	for familyIndex := range minimumRange.Wetland.Families {
		minimumRange.Wetland.Families[familyIndex].GapCenters = []int64{280000, 280000, 280000, 280000}
	}
	if err := ValidateConfig(minimumRange); err != nil {
		t.Fatalf("catalog-7 80k route bounds rejected: %v", err)
	}
	configID, err := ConfigIDFor(minimumRange)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "catalog-seven-boundary-route", Seed: 0, SimulationVersion: BonusSegmentsV2SimulationVersion,
		GeneratorVersion: BonusSegmentsV2GeneratorVersion, ConfigID: configID}, minimumRange)
	if err != nil {
		t.Fatal(err)
	}
	state.Pipes = []Pipe{}
	state.NextPipeIndex, state.NextSpawnPipeIndex = 12, 12
	start := int64(100000)
	state.NextPipeX = &start
	state.LastGapCenter = 280000
	generated, err := GenerateNext(state)
	if err != nil {
		t.Fatal(err)
	}
	centers := []int64{generated.State.Pipes[0].GapCenter, generated.State.Pipes[1].GapCenter, generated.State.Pipes[2].GapCenter}
	if max64(centers[0], max64(centers[1], centers[2]))-min64(centers[0], min64(centers[1], centers[2])) != 80000 || abs(centers[2]-centers[1]) != 80000 {
		t.Fatalf("catalog-7 route was flattened at the 80k boundary: %v", centers)
	}

	tooSmallDelta := cloneConfig(minimumRange)
	tooSmallDelta.Pipes.MaxGapDelta = 70000
	if err := ValidateConfig(tooSmallDelta); err == nil {
		t.Fatal("catalog-7 accepted maxGapDelta below the 80k slalom transition")
	}
	tooSmallRange := cloneConfig(minimumRange)
	tooSmallRange.Pipes.GapMaxCenter = 319999
	if err := ValidateConfig(tooSmallRange); err == nil {
		t.Fatal("catalog-7 accepted a world gap-center range below 80k")
	}
}

func TestCatalogSixRecoverySpacingMatchesTypeScript(t *testing.T) {
	state, err := CreateRun(Descriptor{RunID: "catalog-six-recovery", Seed: 1, SimulationVersion: BonusSegmentsSimulationVersion,
		GeneratorVersion: BonusSegmentsGeneratorVersion, ConfigID: BonusSegmentsConfigID})
	if err != nil {
		t.Fatal(err)
	}
	state.Pipes = []Pipe{}
	state.NextPipeIndex, state.NextSpawnPipeIndex = 12, 12
	start := int64(100000)
	state.NextPipeX = &start
	state.LastGapCenter = 280000
	generated, err := GenerateNext(state)
	if err != nil {
		t.Fatal(err)
	}
	if len(generated.State.Pipes) < 4 {
		t.Fatalf("generated %d recovery stations, want 4", len(generated.State.Pipes))
	}
	for index, pipe := range generated.State.Pipes[:4] {
		if pipe.EncounterFamily != "steady" || pipe.StationSpacing == nil || *pipe.StationSpacing != 267600 {
			t.Fatalf("station %d recovery family/spacing=%s/%v, want steady/267600", index, pipe.EncounterFamily, pipe.StationSpacing)
		}
	}
}

func mustCanonicalJSON(t *testing.T, value any) string {
	t.Helper()
	result, err := CanonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCurrencyFormationRejectsNeighborPipeClearanceRegression(t *testing.T) {
	config := CurrencyFormationsConfiguration()
	config.Pipes.Width = 140000
	for i := range config.Collectibles {
		if config.Collectibles[i].TypeID == "FEATHER" {
			config.Collectibles[i].Radius = 50000
		}
	}
	for i := range config.Wetland.Families {
		if config.Wetland.Families[i].ID == "slalom" {
			config.Wetland.Families[i].GapCenters = []int64{280000, 330000, 250000, 320000}
		}
	}
	stationStep := int64(1)
	owner := Pipe{ID: "pipe-113", Index: 113, X: 0, GapCenter: 330000, StationStep: &stationStep, EncounterFamily: "slalom"}
	points := currencyFormationPoints(config, 1, owner, 50000, false, owner.Index)
	if len(points) != 3 || points[0][0] != 238002 {
		t.Fatalf("slalom station 113 witness nose=%v, want x=238002", points)
	}
	nextStationX, lowerPipeTop := int64(240000), int64(328000)
	neighborCollision := false
	for _, point := range points {
		if point[0]+50000+config.Flight.DuckHalfWidth >= nextStationX && point[1]+50000+config.Flight.DuckHalfHeight >= lowerPipeTop {
			neighborCollision = true
		}
	}
	if !neighborCollision {
		t.Fatalf("regression witness no longer intersects next lower pipe: points=%v", points)
	}
	if err := ValidateConfig(config); err == nil || !strings.Contains(err.Error(), "currency formation clearance") {
		t.Fatalf("catalog-4 accepted neighboring FEATHER pipe collision: %v", err)
	}
}

func TestPairedRoutesScoringFatalOrderingAndRetention(t *testing.T) {
	config := CurrencyFormationsConfiguration()
	config.Pipes.Width = 100000
	config.Pipes.Horizon = 600000
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "paired-retention", Seed: 8, SimulationVersion: CurrencyFormationsSimulationVersion, GeneratorVersion: CurrencyFormationsGeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Pipes) == 0 || len(state.Pipes[0].Obstacles) != 2 {
		t.Fatalf("paired geometry missing: %+v", state.Pipes)
	}
	station := state.Pipes[0]
	station.X, station.Scored = 20000, false
	station.GapCenter = 310000
	station.Obstacles = []ObstacleDefinition{
		{TypeID: "pipes", XOffset: 50000, Y: config.Pipes.CeilingY, Width: 100000, Height: 190000},
		{TypeID: "pipes", XOffset: 50000, Y: 360000, Width: 100000, Height: config.Pipes.FloorY - 360000},
	}
	state.Phase = Running
	state.Tick = config.Pipes.RampTicks
	state.Pipes = []Pipe{station}
	state.Duck.Y, state.Duck.VY = 310000, 0
	passed := 0
	wasScored := false
	retainedAfterScore := false
	for tick := 0; tick < 100; tick++ {
		result, stepErr := Step(state, nil)
		if stepErr != nil {
			t.Fatal(stepErr)
		}
		for _, event := range result.Events {
			if event.Type == "ObstaclePassed" {
				passed++
			}
		}
		state = result.State
		state.Duck.Y, state.Duck.VY = 310000, 0
		stationPresent := false
		for _, pipe := range state.Pipes {
			if pipe.StationID == station.StationID && pipe.Scored {
				stationPresent = true
				wasScored = true
				retainedAfterScore = true
				rightmost := int64(0)
				for _, obstacle := range pipe.Obstacles {
					candidate := obstacle.XOffset + obstacle.Width/2
					if candidate > rightmost {
						rightmost = candidate
					}
				}
				if pipe.X+rightmost+config.Pipes.Width < 0 {
					t.Fatalf("station retained after every rectangle cleared: x=%d rightmost=%d", pipe.X, rightmost)
				}
			}
		}
		if wasScored && !stationPresent {
			break
		}
	}
	stationPresent := false
	for _, pipe := range state.Pipes {
		stationPresent = stationPresent || pipe.StationID == station.StationID
	}
	if passed != 1 || !wasScored || !retainedAfterScore || stationPresent {
		t.Fatalf("paired station lifecycle: passed=%d scored=%v retained=%v stationPresent=%v", passed, wasScored, retainedAfterScore, stationPresent)
	}

	for _, obstacle := range station.Obstacles {
		lethal := cloneState(state)
		lethal.Phase = Running
		lethal.Duck.Y = obstacle.Y + obstacle.Height/2
		lethal.Duck.VY = 0
		lethal.Pipes = []Pipe{station}
		lethal.Pipes[0].X = lethal.Duck.X
		lethal.Pipes[0].Obstacles = []ObstacleDefinition{obstacle}
		result, stepErr := Step(lethal, nil)
		if stepErr != nil {
			t.Fatal(stepErr)
		}
		if result.State.Phase != Dead {
			t.Errorf("paired %s rectangle did not collide", obstacle.TypeID)
		}
	}
	fatal := cloneState(state)
	fatal.Phase = Running
	fatal.Duck.Y = config.Pipes.FloorY - config.Flight.DuckHalfHeight - 1
	fatal.Duck.VY = 0
	fatal.Pipes = []Pipe{station}
	fatal.Pipes[0].X = 60000
	result, err := Step(fatal, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range result.Events {
		if event.Type == "ObstaclePassed" {
			t.Fatal("fatal paired tick emitted an obstacle score")
		}
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

func TestVariedPipesSharedVectors(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/varied-pipes-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Seed     int64   `json:"seed"`
			Block    int64   `json:"block"`
			Centers  []int64 `json:"centers"`
			Spacings []int64 `json:"spacings"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixture.Cases {
		s, err := CreateRun(Descriptor{RunID: "vector", Seed: v.Seed, SimulationVersion: VariedPipesSimulationVersion, GeneratorVersion: VariedPipesGeneratorVersion, ConfigID: VariedPipesConfigID})
		if err != nil {
			t.Fatal(err)
		}
		x := int64(100000)
		s.Pipes = nil
		s.NextPipeIndex = v.Block * 4
		s.NextPipeX = &x
		s.LastGapCenter = 280000
		result, err := GenerateNext(s)
		if err != nil {
			t.Fatal(err)
		}
		for i, p := range result.State.Pipes[:4] {
			if p.GapCenter != v.Centers[i] || *p.StationSpacing != v.Spacings[i] {
				t.Fatalf("seed %d block %d station %d: got %d/%d want %d/%d", v.Seed, v.Block, i, p.GapCenter, *p.StationSpacing, v.Centers[i], v.Spacings[i])
			}
		}
	}
}

func TestPressurePipesSharedVectors(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/pressure-pipes-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Seed     int64   `json:"seed"`
			Block    int64   `json:"block"`
			Centers  []int64 `json:"centers"`
			Spacings []int64 `json:"spacings"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixture.Cases {
		s, err := CreateRun(Descriptor{RunID: "vector", Seed: v.Seed, SimulationVersion: PressurePipesSimulationVersion, GeneratorVersion: PressurePipesGeneratorVersion, ConfigID: PressurePipesConfigID})
		if err != nil {
			t.Fatal(err)
		}
		x := int64(100000)
		s.Pipes = nil
		s.NextPipeIndex = v.Block * 4
		s.NextPipeX = &x
		s.LastGapCenter = 280000
		result, err := GenerateNext(s)
		if err != nil {
			t.Fatal(err)
		}
		for i, p := range result.State.Pipes[:4] {
			if p.GapCenter != v.Centers[i] || *p.StationSpacing != v.Spacings[i] {
				t.Fatalf("seed %d block %d station %d: got %d/%d want %d/%d", v.Seed, v.Block, i, p.GapCenter, *p.StationSpacing, v.Centers[i], v.Spacings[i])
			}
		}
	}
}

func TestPressurePipesFullStateReplay(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/pressure-pipes-replay-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestDensePipesSharedVectors(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/dense-pipes-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Seed     int64   `json:"seed"`
			Block    int64   `json:"block"`
			Centers  []int64 `json:"centers"`
			Spacings []int64 `json:"spacings"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixture.Cases {
		s, err := CreateRun(Descriptor{RunID: "vector", Seed: v.Seed, SimulationVersion: DensePipesSimulationVersion, GeneratorVersion: DensePipesGeneratorVersion, ConfigID: DensePipesConfigID})
		if err != nil {
			t.Fatal(err)
		}
		x := int64(100000)
		s.Pipes = nil
		s.NextPipeIndex = v.Block * 4
		s.NextPipeX = &x
		s.LastGapCenter = 280000
		result, err := GenerateNext(s)
		if err != nil {
			t.Fatal(err)
		}
		for i, p := range result.State.Pipes[:4] {
			if p.GapCenter != v.Centers[i] || *p.StationSpacing != v.Spacings[i] {
				t.Fatalf("seed %d block %d station %d: got %d/%d want %d/%d", v.Seed, v.Block, i, p.GapCenter, *p.StationSpacing, v.Centers[i], v.Spacings[i])
			}
		}
	}
}
func TestDensePipesFullStateReplay(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/dense-pipes-replay-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestDensePipesCapacityBounds(t *testing.T) {
	config := DensePipesConfiguration()
	if err := ValidateConfig(config); err != nil {
		t.Fatal(err)
	}
	config.Limits.MaxActivePipes = 17
	if err := ValidateConfig(config); err == nil {
		t.Fatal("insufficient pipe horizon capacity accepted")
	}
	config = DensePipesConfiguration()
	config.StarSchedule.MinIntervalPipes = 15
	if err := ValidateConfig(config); err == nil {
		t.Fatal("insufficient Star spacing accepted")
	}
	config = DensePipesConfiguration()
	config.Limits.MaxActiveCollectibles = 21
	if err := ValidateConfig(config); err == nil {
		t.Fatal("insufficient pickup capacity accepted")
	}
}

func TestBaseBonusSharedVectors(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/base-bonus-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Seed     int64   `json:"seed"`
			Block    int64   `json:"block"`
			Centers  []int64 `json:"centers"`
			Spacings []int64 `json:"spacings"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixture.Cases {
		s, err := CreateRun(Descriptor{RunID: "vector", Seed: v.Seed, SimulationVersion: BaseBonusSimulationVersion, GeneratorVersion: BaseBonusGeneratorVersion, ConfigID: BaseBonusConfigID})
		if err != nil {
			t.Fatal(err)
		}
		x := int64(100000)
		s.Pipes = nil
		s.NextPipeIndex = v.Block * 4
		s.NextPipeX = &x
		s.LastGapCenter = 280000
		result, err := GenerateNext(s)
		if err != nil {
			t.Fatal(err)
		}
		for i, p := range result.State.Pipes[:4] {
			if p.GapCenter != v.Centers[i] || *p.StationSpacing != v.Spacings[i] {
				t.Fatalf("seed %d block %d station %d: got %d/%d want %d/%d", v.Seed, v.Block, i, p.GapCenter, *p.StationSpacing, v.Centers[i], v.Spacings[i])
			}
		}
	}
}
func TestBaseBonusFullStateReplay(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/base-bonus-replay-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestVariedBaseSharedVectors(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/varied-base-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Seed     int64   `json:"seed"`
			Block    int64   `json:"block"`
			Centers  []int64 `json:"centers"`
			Spacings []int64 `json:"spacings"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixture.Cases {
		s, err := CreateRun(Descriptor{RunID: "vector", Seed: v.Seed, SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: DefaultConfigID})
		if err != nil {
			t.Fatal(err)
		}
		x := int64(100000)
		s.Pipes = nil
		s.NextPipeIndex = v.Block * 4
		s.NextPipeX = &x
		s.LastGapCenter = 280000
		result, err := GenerateNext(s)
		if err != nil {
			t.Fatal(err)
		}
		for i, p := range result.State.Pipes[:4] {
			if p.GapCenter != v.Centers[i] || *p.StationSpacing != v.Spacings[i] {
				t.Fatalf("seed %d block %d station %d: got %d/%d want %d/%d", v.Seed, v.Block, i, p.GapCenter, *p.StationSpacing, v.Centers[i], v.Spacings[i])
			}
		}
	}
}
func TestVariedBaseFullStateReplay(t *testing.T) {
	if err := VerifyWetlandFixtures("../../../contracts/simulation/varied-base-replay-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestVariedBaseNarrowBounds(t *testing.T) {
	c := VariedBaseConfiguration()
	c.Pipes.GapMinCenter, c.Pipes.GapMaxCenter, c.Pipes.MaxGapDelta = 240000, 320000, 80000
	for i := range c.Wetland.Families {
		c.Wetland.Families[i].GapCenters = []int64{280000, 280000, 280000, 280000}
	}
	if err := ValidateConfig(c); err != nil {
		t.Fatal(err)
	}
	for seed := uint32(0); seed < 64; seed++ {
		for _, entry := range []int64{240000, 280000, 320000} {
			previous := entry
			for index := int64(8); index < 12; index++ {
				center := irregularBaseCenter(seed, index, previous, c)
				if center < c.Pipes.GapMinCenter || center > c.Pipes.GapMaxCenter || abs(center-previous) < 30000 || abs(center-previous) > c.Pipes.MaxGapDelta {
					t.Fatalf("seed %d index %d previous %d center %d", seed, index, previous, center)
				}
				previous = center
			}
		}
	}
}
