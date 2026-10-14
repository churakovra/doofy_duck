package simulation

import (
	"encoding/json"
	"os"
	"testing"
)

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

func TestFoundation2MixerVectors(t *testing.T) {
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

func TestFoundation2FullFixtureParity(t *testing.T) {
	if err := VerifyFoundationFixtures("../../../contracts/simulation/golden-v1.json"); err != nil {
		t.Fatal(err)
	}
}

func TestExportedDefaultsAreIndependentCopies(t *testing.T) {
	patterns := PatternCatalog()
	config := DefaultConfiguration()
	patterns[0].Gaps[0]++
	config.Collectibles[0].Amount++
	if PatternCatalog()[0].Gaps[0] == patterns[0].Gaps[0] {
		t.Fatal("pattern accessor exposed canonical gaps")
	}
	if DefaultConfiguration().Collectibles[0].Amount == config.Collectibles[0].Amount {
		t.Fatal("config accessor exposed canonical definitions")
	}
}

func TestValidateConfigRejectsNumbersOutsideJavaScriptSafeIntegerDomain(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"limit":   func(c *Config) { c.Limits.MaxActivePipes = 1 << 53 },
		"amount":  func(c *Config) { c.Collectibles[0].Amount = 1 << 53 },
		"version": func(c *Config) { c.Collectibles[0].Version = 1 << 53 },
	} {
		t.Run(name, func(t *testing.T) {
			c := DefaultConfiguration()
			mutate(&c)
			if err := ValidateConfig(c); err == nil {
				t.Fatal("accepted unsafe integer")
			}
		})
	}
}

func TestValidateConfigRejectsInt64MinValue(t *testing.T) {
	config := DefaultConfiguration()
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
	config := DefaultConfiguration()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	s, err := CreateRun(Descriptor{"totals-test", 1, "1.0.0", "1.0.0", id}, config)
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
