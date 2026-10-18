package simulation

import (
	"encoding/json"
	"os"
	"testing"
)

type wetlandValidationCase struct {
	Name            string `json:"name"`
	Accepted        bool   `json:"accepted"`
	NoStars         bool   `json:"noStars"`
	WithChallenges  bool   `json:"withChallenges"`
	RemoveFeather   bool   `json:"removeFeather"`
	RecoverySpacing *int64 `json:"recoverySpacing"`
	Limits          *struct {
		MaxActivePipes        *int64 `json:"maxActivePipes"`
		MaxActiveCollectibles *int64 `json:"maxActiveCollectibles"`
	} `json:"limits"`
	Flight *struct {
		DuckHalfHeight *int64 `json:"duckHalfHeight"`
	} `json:"flight"`
	Pipes *struct {
		Spacing  *int64 `json:"spacing"`
		Width    *int64 `json:"width"`
		CeilingY *int64 `json:"ceilingY"`
		FloorY   *int64 `json:"floorY"`
	} `json:"pipes"`
	Coin *struct {
		Family  string `json:"family"`
		Step    int    `json:"step"`
		XOffset *int64 `json:"xOffset"`
		YOffset *int64 `json:"yOffset"`
	} `json:"coin"`
	StarRoute *struct {
		XOffset *int64 `json:"xOffset"`
		YOffset *int64 `json:"yOffset"`
	} `json:"starRoute"`
}

func TestSharedWetlandConfigurationValidationCorpus(t *testing.T) {
	data, err := os.ReadFile("../../../contracts/simulation/wetland-config-validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Cases []wetlandValidationCase `json:"cases"`
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	for _, testCase := range corpus.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			config := WetlandConfiguration()
			if testCase.WithChallenges {
				config.Challenges = PriorDefaultConfiguration().Challenges
			}
			if testCase.NoStars {
				config.StarSchedule = nil
			}
			if testCase.RemoveFeather {
				kept := config.Collectibles[:0]
				for _, definition := range config.Collectibles {
					if definition.TypeID != "FEATHER" {
						kept = append(kept, definition)
					}
				}
				config.Collectibles = kept
			}
			if testCase.RecoverySpacing != nil {
				config.Wetland.RecoverySpacing = *testCase.RecoverySpacing
			}
			if testCase.Limits != nil {
				if testCase.Limits.MaxActivePipes != nil {
					config.Limits.MaxActivePipes = *testCase.Limits.MaxActivePipes
				}
				if testCase.Limits.MaxActiveCollectibles != nil {
					config.Limits.MaxActiveCollectibles = *testCase.Limits.MaxActiveCollectibles
				}
			}
			if testCase.Flight != nil && testCase.Flight.DuckHalfHeight != nil {
				config.Flight.DuckHalfHeight = *testCase.Flight.DuckHalfHeight
			}
			if testCase.Pipes != nil {
				if testCase.Pipes.Spacing != nil {
					config.Pipes.Spacing = *testCase.Pipes.Spacing
				}
				if testCase.Pipes.Width != nil {
					config.Pipes.Width = *testCase.Pipes.Width
				}
				if testCase.Pipes.CeilingY != nil {
					config.Pipes.CeilingY = *testCase.Pipes.CeilingY
				}
				if testCase.Pipes.FloorY != nil {
					config.Pipes.FloorY = *testCase.Pipes.FloorY
				}
			}
			if testCase.Coin != nil {
				for i := range config.Wetland.Families {
					family := &config.Wetland.Families[i]
					if family.ID == testCase.Coin.Family && testCase.Coin.Step >= 0 && testCase.Coin.Step < len(family.RewardRoute) {
						if testCase.Coin.XOffset != nil {
							family.RewardRoute[testCase.Coin.Step].XOffset = *testCase.Coin.XOffset
						}
						if testCase.Coin.YOffset != nil {
							family.RewardRoute[testCase.Coin.Step].YOffset = *testCase.Coin.YOffset
						}
					}
				}
			}
			if testCase.StarRoute != nil {
				if testCase.StarRoute.XOffset != nil {
					config.Wetland.StarRoute.XOffset = *testCase.StarRoute.XOffset
				}
				if testCase.StarRoute.YOffset != nil {
					config.Wetland.StarRoute.YOffset = *testCase.StarRoute.YOffset
				}
			}
			err := ValidateConfig(config)
			if testCase.Accepted && err != nil {
				t.Fatalf("accepted config rejected: %v", err)
			}
			if !testCase.Accepted && err == nil {
				t.Fatal("rejected config accepted")
			}
		})
	}
}

func TestWetlandConfigDeepCloneOwnsNestedRoutePoints(t *testing.T) {
	config := WetlandConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "wetland-config-copy", Seed: 1, SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	coinX, starX := state.Config.Wetland.Families[0].RewardRoute[0].XOffset, state.Config.Wetland.StarRoute.XOffset
	config.Wetland.Families[0].RewardRoute[0].XOffset++
	config.Wetland.StarRoute.XOffset++
	if state.Config.Wetland.Families[0].RewardRoute[0].XOffset != coinX || state.Config.Wetland.StarRoute.XOffset != starX {
		t.Fatal("run config shares mutable nested reward routes")
	}
}

func TestWetlandStationsUseConfiguredObstacleWidthAndRightEdge(t *testing.T) {
	config := WetlandConfiguration()
	config.Pipes.Width = 100000
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{RunID: "wetland-right-edge", Seed: 4, SimulationVersion: SimulationVersion, GeneratorVersion: GeneratorVersion, ConfigID: id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase, state.Tick = Running, config.Pipes.RampTicks
	step := int64(0)
	stationID := "custom-right-edge"
	state.Pipes = []Pipe{{ID: stationID, Index: 0, X: 20000, GapCenter: 280000, Scored: false, StationID: stationID, StationStep: &step, EncounterFamily: "steady", Obstacles: []ObstacleDefinition{{TypeID: "pipes", XOffset: 50000, Y: 0, Width: 100000, Height: 1}}}}
	passed := 0
	for tick := 0; tick < 7; tick++ {
		result, err := Step(state, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, event := range result.Events {
			if event.Type == "ObstaclePassed" {
				passed++
			}
		}
		state = result.State
		if tick < 6 && passed != 0 {
			t.Fatalf("station scored before rightmost rectangle cleared on tick %d", tick)
		}
	}
	if passed != 1 {
		t.Fatalf("score events=%d, want 1", passed)
	}
	for _, pipe := range state.Pipes {
		if pipe.StationID == stationID {
			t.Fatal("cleared station was retained")
		}
	}
	for _, pipe := range state.Pipes {
		for _, obstacle := range pipe.Obstacles {
			if obstacle.Width != config.Pipes.Width {
				t.Fatalf("obstacle width=%d, config width=%d", obstacle.Width, config.Pipes.Width)
			}
		}
	}
}
