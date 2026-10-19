package simulation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

type fixture struct {
	FixtureRevision string `json:"fixtureRevision"`
	MixerVectors    []struct {
		Input  uint32 `json:"input"`
		Output uint32 `json:"output"`
	} `json:"mixerVectors"`
	Cases []struct {
		Name       string            `json:"name"`
		Synthetic  bool              `json:"syntheticInitialState"`
		Initial    json.RawMessage   `json:"initialState"`
		Operations []json.RawMessage `json:"operations"`
	} `json:"cases"`
	Invalid []json.RawMessage `json:"invalidCases"`
}

func VerifyFoundationFixtures(path string) error {
	data, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	var f fixture
	if e = json.Unmarshal(data, &f); e != nil {
		return e
	}
	if f.FixtureRevision != "stepped-challenges-1" || len(f.Cases) != 13 || len(f.Invalid) != 5 || len(f.MixerVectors) != 4 {
		return fmt.Errorf("unexpected fixture revision/case count")
	}
	operationCount, advanceTicks := 0, 0
	for _, fixtureCase := range f.Cases {
		operationCount += len(fixtureCase.Operations)
		for _, rawOperation := range fixtureCase.Operations {
			var operation struct {
				Kind  string `json:"kind"`
				Ticks int    `json:"ticks"`
			}
			if err := json.Unmarshal(rawOperation, &operation); err != nil {
				return err
			}
			if operation.Kind == "advance" {
				advanceTicks += operation.Ticks
			}
		}
	}
	if operationCount != 40 || advanceTicks != 29200 {
		return fmt.Errorf("unexpected fixture operation/tick count: %d/%d", operationCount, advanceTicks)
	}
	for _, c := range f.Cases {
		if len(c.Initial) == 0 || string(c.Initial) == "null" {
			return fmt.Errorf("%s missing initialState", c.Name)
		}
		var s State
		if e = json.Unmarshal(c.Initial, &s); e != nil {
			return fmt.Errorf("%s initialState: %w", c.Name, e)
		}
		if c.Synthetic {
			if er := equalRaw(s, c.Initial); er != nil {
				return fmt.Errorf("%s synthetic initial: %w", c.Name, er)
			}
		} else {
			created, er := CreateRun(s.Descriptor, s.Config)
			if er != nil {
				return fmt.Errorf("%s createRun: %w", c.Name, er)
			}
			if er = equalRaw(created, c.Initial); er != nil {
				return fmt.Errorf("%s initial: %w", c.Name, er)
			}
		}
		for i, raw := range c.Operations {
			var op map[string]json.RawMessage
			if e = json.Unmarshal(raw, &op); e != nil {
				return e
			}
			if len(op["expectedState"]) == 0 || string(op["expectedState"]) == "null" {
				return fmt.Errorf("%s op%d missing expectedState", c.Name, i)
			}
			if len(op["expectedEvents"]) == 0 || string(op["expectedEvents"]) == "null" {
				return fmt.Errorf("%s op%d missing expectedEvents", c.Name, i)
			}
			var kind string
			if e = json.Unmarshal(op["kind"], &kind); e != nil {
				return fmt.Errorf("%s op%d missing/invalid kind", c.Name, i)
			}
			var got State
			var events []Event = []Event{}
			switch kind {
			case "step":
				var frames []Input
				if len(op["frames"]) > 0 {
					_ = json.Unmarshal(op["frames"], &frames)
				}
				r, er := Step(s, frames)
				if er != nil {
					return fmt.Errorf("%s op%d: %w", c.Name, i, er)
				}
				got, events = r.State, r.Events
			case "advance":
				var ticks int
				_ = json.Unmarshal(op["ticks"], &ticks)
				var flapTicks []int
				_ = json.Unmarshal(op["flapTicks"], &flapTicks)
				flaps := map[int]bool{}
				for _, t := range flapTicks {
					flaps[t] = true
				}
				events = []Event{}
				got = s
				for t := 1; t <= ticks; t++ {
					fr := []Input{}
					if flaps[t] {
						fr = append(fr, Input{got.NextInputSequence, "FLAP"})
					}
					r, er := Step(got, fr)
					if er != nil {
						return fmt.Errorf("%s op%d: %w", c.Name, i, er)
					}
					got = r.State
					events = append(events, r.Events...)
				}
			case "pause":
				got, e = Pause(s)
			case "resume":
				got, e = Resume(s)
			case "restart":
				var d Descriptor
				_ = json.Unmarshal(op["descriptor"], &d)
				got, e = Restart(s, d, s.Config)
				events = []Event{}
			default:
				return fmt.Errorf("unknown op %q", kind)
			}
			if e != nil {
				return fmt.Errorf("%s op%d: %w", c.Name, i, e)
			}
			if e = equalRaw(got, op["expectedState"]); e != nil {
				return fmt.Errorf("%s op%d state: %w", c.Name, i, e)
			}
			if e = equalRaw(events, op["expectedEvents"]); e != nil {
				return fmt.Errorf("%s op%d events: %w", c.Name, i, e)
			}
			s = got
		}
	}
	for i, raw := range f.Invalid {
		var x struct {
			Name       string     `json:"name"`
			Kind       string     `json:"kind"`
			Descriptor Descriptor `json:"descriptor"`
			Config     Config     `json:"config"`
			Initial    State      `json:"initialState"`
			Frames     []Input    `json:"frames"`
		}
		if e = json.Unmarshal(raw, &x); e != nil {
			return e
		}
		var er error
		if x.Kind == "create" {
			_, er = CreateRun(x.Descriptor, x.Config)
		} else {
			_, er = Step(x.Initial, x.Frames)
		}
		if er == nil {
			return fmt.Errorf("invalid case %d (%s) did not reject", i, x.Name)
		}
	}
	return nil
}

// VerifyWetlandFixtures checks reviewed wetland state/event expectations
// independently from the TypeScript producer and frozen fixtures.
func VerifyWetlandFixtures(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var fixture struct {
		FixtureRevision   string `json:"fixtureRevision"`
		SimulationVersion string `json:"simulationVersion"`
		GeneratorVersion  string `json:"generatorVersion"`
		ConfigID          string `json:"configId"`
		Cases             []struct {
			Name       string          `json:"name"`
			Synthetic  bool            `json:"syntheticInitialState"`
			Initial    json.RawMessage `json:"initialState"`
			Operations []struct {
				Kind           string          `json:"kind"`
				Frames         []Input         `json:"frames"`
				ExpectedState  json.RawMessage `json:"expectedState"`
				ExpectedEvents json.RawMessage `json:"expectedEvents"`
			} `json:"operations"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		return err
	}
	priorFixture := fixture.FixtureRevision == "wetland-stations-1" && fixture.SimulationVersion == WetlandSimulationVersion &&
		fixture.GeneratorVersion == WetlandGeneratorVersion && fixture.ConfigID == WetlandDefaultConfigID && len(fixture.Cases) >= 5
	variedFixture := fixture.FixtureRevision == "wetland-varied-stations-1" && fixture.SimulationVersion == SimulationVersion &&
		fixture.GeneratorVersion == GeneratorVersion && fixture.ConfigID == DefaultConfigID && len(fixture.Cases) >= 3
	if !priorFixture && !variedFixture {
		return fmt.Errorf("unexpected wetland fixture identity/case count")
	}
	for _, example := range fixture.Cases {
		var state State
		if err := json.Unmarshal(example.Initial, &state); err != nil {
			return fmt.Errorf("%s initial: %w", example.Name, err)
		}
		if example.Synthetic {
			if err := equalRaw(state, example.Initial); err != nil {
				return fmt.Errorf("%s initial state: %w", example.Name, err)
			}
		} else {
			created, err := CreateRun(state.Descriptor, state.Config)
			if err != nil {
				return fmt.Errorf("%s create: %w", example.Name, err)
			}
			if err := equalRaw(created, example.Initial); err != nil {
				return fmt.Errorf("%s initial state: %w", example.Name, err)
			}
			state = created
		}
		for index, operation := range example.Operations {
			if operation.Kind != "step" {
				return fmt.Errorf("%s op%d unsupported kind %q", example.Name, index, operation.Kind)
			}
			result, err := Step(state, operation.Frames)
			if err != nil {
				return fmt.Errorf("%s op%d: %w", example.Name, index, err)
			}
			if err := equalRaw(result.State, operation.ExpectedState); err != nil {
				return fmt.Errorf("%s op%d state: %w", example.Name, index, err)
			}
			if err := equalRaw(result.Events, operation.ExpectedEvents); err != nil {
				return fmt.Errorf("%s op%d events: %w", example.Name, index, err)
			}
			state = result.State
		}
	}
	return nil
}
func equalRaw(actual any, expected json.RawMessage) error {
	got, err := json.Marshal(actual)
	if err != nil {
		return err
	}
	decode := func(data []byte) (any, error) {
		var value any
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		return value, nil
	}
	gotValue, err := decode(got)
	if err != nil {
		return err
	}
	wantValue, err := decode(expected)
	if err != nil {
		return err
	}
	gotCanonical, err := canonical(gotValue)
	if err != nil {
		return err
	}
	wantCanonical, err := canonical(wantValue)
	if err != nil {
		return err
	}
	if gotCanonical == wantCanonical {
		return nil
	}
	return fmt.Errorf("raw JSON mismatch: got %s want %s", truncate(gotCanonical), truncate(wantCanonical))
}

func equal(a, b any) error {
	x, e := json.Marshal(a)
	if e != nil {
		return e
	}
	y, e := json.Marshal(b)
	if e != nil {
		return e
	}
	if bytes.Equal(x, y) {
		return nil
	}
	i := 0
	for i < len(x) && i < len(y) && x[i] == y[i] {
		i++
	}
	lo := i - 100
	if lo < 0 {
		lo = 0
	}
	hi := i + 180
	if hi > len(x) {
		hi = len(x)
	}
	whi := i + 180
	if whi > len(y) {
		whi = len(y)
	}
	return fmt.Errorf("JSON mismatch at byte %d: got %s want %s", i, x[lo:hi], y[lo:whi])
}
func truncate(s string) string {
	if len(s) > 500 {
		return s[:500] + "…"
	}
	return s
}
