package simulation

import "testing"

func TestSeededGapWalkContinuesAfterPruning(t *testing.T) {
	config := DefaultConfiguration()
	config.Pipes.Horizon = 2_500_000
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{"gap-walk", 142, "1.2.0", "1.1.0", id}, config)
	if err != nil {
		t.Fatal(err)
	}
	previous := state.LastGapCenter
	state.Pipes = []Pipe{}
	refilled, err := GenerateNext(state)
	if err != nil {
		t.Fatal(err)
	}
	first := refilled.State.Pipes[0].GapCenter
	delta := first - previous
	if delta < 0 {
		delta = -delta
	}
	if delta > config.Pipes.MaxGapDelta {
		t.Fatalf("gap changed by %d after pruning", delta)
	}
}

func TestSeededFeatherTapWitness(t *testing.T) {
	config := DefaultConfiguration()
	state, err := CreateRun(Descriptor{"feather-witness", 0, "1.2.0", "1.1.0", "dd-v1-arcade-v2"}, config)
	if err != nil {
		t.Fatal(err)
	}
	taps := map[int64]bool{1: true, 19: true, 52: true, 86: true, 120: true, 166: true}
	var sequence int64
	picked := false
	for state.Phase != Dead && state.Tick < 1000 {
		frames := []Input{}
		if taps[state.Tick+1] {
			frames = append(frames, Input{sequence, "FLAP"})
			sequence++
		}
		result, e := Step(state, frames)
		if e != nil {
			t.Fatal(e)
		}
		state = result.State
		for _, event := range result.Events {
			if event.Type == "CurrencyCollected" && event.TypeID == "FEATHER" {
				picked = true
			}
		}
		if picked {
			break
		}
	}
	if !picked || state.Tick != 171 || state.Totals["FEATHER"] != 1 {
		t.Fatalf("pickup witness: picked=%v tick=%d totals=%v", picked, state.Tick, state.Totals)
	}
	for state.Phase != Dead && state.Tick < 1000 {
		result, e := Step(state, nil)
		if e != nil {
			t.Fatal(e)
		}
		state = result.State
	}
	if state.Phase != Dead || state.Tick != 229 || state.Totals["FEATHER"] != 1 {
		t.Fatalf("terminal witness: phase=%s tick=%d totals=%v", state.Phase, state.Tick, state.Totals)
	}
}
