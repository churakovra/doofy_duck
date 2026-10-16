package simulation

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"
)

type defaultReplay struct {
	inputs      [][]Input
	final       State
	fingerprint string
}

// buildDefaultReplay authors and executes the controller schedule before a
// benchmark starts. It steers toward the nearest approaching default gap.
func buildDefaultReplay(ticks int) (defaultReplay, error) {
	config := DefaultConfiguration()
	configID, err := ConfigIDFor(config)
	if err != nil {
		return defaultReplay{}, err
	}
	state, err := CreateRun(Descriptor{"benchmark-replay", 42, SimulationVersion, GeneratorVersion, configID}, config)
	if err != nil {
		return defaultReplay{}, err
	}
	replay := defaultReplay{inputs: make([][]Input, 0, ticks)}
	for range ticks {
		input := []Input(nil)
		if state.Phase == Ready {
			input = []Input{{Sequence: state.NextInputSequence, Action: "FLAP"}}
		} else {
			target := state.Pipes[0].GapCenter
			for _, pipe := range state.Pipes {
				if pipe.X+config.Pipes.Width/2 >= config.Flight.DuckX-config.Flight.DuckHalfWidth {
					target = pipe.GapCenter
					break
				}
			}
			// Brake a rising duck near the opening center and flap before
			// downward velocity carries it below the safe corridor.
			if state.Duck.Y > target-12000 && state.Duck.VY > -1600 {
				input = []Input{{Sequence: state.NextInputSequence, Action: "FLAP"}}
			}
		}
		result, err := Step(state, input)
		if err != nil {
			return defaultReplay{}, fmt.Errorf("author replay tick %d: %w", state.Tick+1, err)
		}
		state = result.State
		replay.inputs = append(replay.inputs, input)
	}
	replay.final = state
	encoded, err := json.Marshal(state)
	if err != nil {
		return defaultReplay{}, err
	}
	digest := sha256.Sum256(encoded)
	replay.fingerprint = hex.EncodeToString(digest[:])
	return replay, nil
}

func TestDefaultReplayWorkloadIsDeterministicAndActive(t *testing.T) {
	first, err := buildDefaultReplay(300)
	if err != nil {
		t.Fatal(err)
	}
	second, err := buildDefaultReplay(300)
	if err != nil {
		t.Fatal(err)
	}
	if first.final.Phase != Running || first.final.Tick != 300 {
		t.Fatalf("replay ended at phase %s tick %d", first.final.Phase, first.final.Tick)
	}
	if first.final.Score != 2 {
		t.Fatalf("replay score = %d, want 2", first.final.Score)
	}
	const wantFingerprint = "96f22c92c4f3aa301d09d19169c70f98dc95fa938506841289482e1706c78289"
	if first.fingerprint != wantFingerprint || second.fingerprint != wantFingerprint {
		t.Fatalf("replay fingerprint first=%q second=%q want=%q", first.fingerprint, second.fingerprint, wantFingerprint)
	}
	t.Logf("replay final score=%d fingerprint=%s", first.final.Score, first.fingerprint)
}

func benchmarkDefaultRunningState(b *testing.B) State {
	b.Helper()
	config := DefaultConfiguration()
	configID, err := ConfigIDFor(config)
	if err != nil {
		b.Fatal(err)
	}
	state, err := CreateRun(Descriptor{"benchmark-step", 42, SimulationVersion, GeneratorVersion, configID}, config)
	if err != nil {
		b.Fatal(err)
	}
	result, err := Step(state, []Input{{Sequence: 0, Action: "FLAP"}})
	if err != nil || result.State.Phase != Running {
		b.Fatalf("start default run: phase=%s err=%v", result.State.Phase, err)
	}
	return result.State
}

var benchmarkStateSink State

func BenchmarkDefaultStep(b *testing.B) {
	for _, tc := range []struct {
		name string
		flap bool
	}{{"without-flap", false}, {"with-flap", true}} {
		b.Run(tc.name, func(b *testing.B) {
			state := benchmarkDefaultRunningState(b)
			frames := []Input(nil)
			if tc.flap {
				frames = []Input{{Sequence: state.NextInputSequence, Action: "FLAP"}}
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				result, err := Step(state, frames)
				if err != nil {
					b.Fatal(err)
				}
				benchmarkStateSink = result.State
			}
		})
	}
}

func BenchmarkDefaultReplay300Ticks(b *testing.B) {
	replay, err := buildDefaultReplay(300)
	if err != nil {
		b.Fatal(err)
	}
	if replay.final.Phase != Running {
		b.Fatalf("authored replay ended in %s", replay.final.Phase)
	}
	initial := benchmarkDefaultRunningState(b)
	// The first authored operation starts from READY, so include it by using a
	// freshly created state for each replay iteration.
	initial, err = CreateRun(initial.Descriptor, initial.Config)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		state := initial
		for _, frames := range replay.inputs {
			result, err := Step(state, frames)
			if err != nil {
				b.Fatal(err)
			}
			state = result.State
		}
		if state.Phase != Running || state.Tick != 300 {
			b.Fatalf("replay ended at phase %s tick %d", state.Phase, state.Tick)
		}
		benchmarkStateSink = state
	}
}
