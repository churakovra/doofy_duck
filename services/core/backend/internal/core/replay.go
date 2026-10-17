package core

import (
	"fmt"

	sim "doofyduck/simulation"
)

const (
	ActiveTickLimit     int64 = 216000
	CheckpointTickLimit       = 120
)

// ReplayCheckpoint applies only submitted tick inputs to the authoritative Go simulation.
func ReplayCheckpoint(state sim.State, activeTicks int64, ticks [][]sim.Input, tickLimit int64) (sim.State, int64, string, error) {
	if len(ticks) < 1 || len(ticks) > CheckpointTickLimit {
		return sim.State{}, activeTicks, "", fmt.Errorf("checkpoint tick count must be between 1 and %d", CheckpointTickLimit)
	}
	if tickLimit < 1 || activeTicks < 0 || activeTicks > tickLimit || (state.Phase != sim.Ready && state.Phase != sim.Running) {
		return sim.State{}, activeTicks, "", fmt.Errorf("invalid run state")
	}
	for i, tickInputs := range ticks {
		if activeTicks >= tickLimit {
			return sim.State{}, activeTicks, "", fmt.Errorf("run active tick limit reached")
		}
		if len(tickInputs) > 1 {
			return sim.State{}, activeTicks, "", fmt.Errorf("at most one input is allowed per tick")
		}
		if state.Phase == sim.Ready && len(tickInputs) == 0 {
			return sim.State{}, activeTicks, "", fmt.Errorf("ready tick must start the run with FLAP")
		}
		result, err := sim.Step(state, tickInputs)
		if err != nil {
			return sim.State{}, activeTicks, "", fmt.Errorf("simulation rejected tick %d: %w", i, err)
		}
		state = result.State
		activeTicks++
		if state.Phase == sim.Dead {
			if i != len(ticks)-1 {
				return sim.State{}, activeTicks, "", fmt.Errorf("ticks after run death")
			}
			return state, activeTicks, "death", nil
		}
		if activeTicks == tickLimit {
			if i != len(ticks)-1 {
				return sim.State{}, activeTicks, "", fmt.Errorf("ticks after flight cap")
			}
			return state, activeTicks, "flight_cap", nil
		}
	}
	return state, activeTicks, "", nil
}
