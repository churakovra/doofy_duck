package simulation

import (
	"fmt"
	"math"
	"reflect"
	"testing"
)

func challengeBlockAt(t *testing.T, block int64, seed int64) State {
	t.Helper()
	c := PriorDefaultConfiguration()
	c.Pipes.Horizon = 1_400_000
	id, err := ConfigIDFor(c)
	if err != nil {
		t.Fatal(err)
	}
	d := Descriptor{"challenge-test", seed, PriorSimulationVersion, PriorGeneratorVersion, id}
	s, err := CreateRun(d, c)
	if err != nil {
		t.Fatal(err)
	}
	s.Pipes = []Pipe{}
	s.NextPipeIndex = block * 4
	return s
}

func TestSteppedChallengesMarkDeterministicFourPipeFamilies(t *testing.T) {
	first, err := GenerateNext(challengeBlockAt(t, 0, 0x12345678))
	if err != nil {
		t.Fatal(err)
	}
	second, err := GenerateNext(challengeBlockAt(t, 0, 0x12345678))
	if err != nil {
		t.Fatal(err)
	}
	if len(first.State.Pipes) != 4 || len(second.State.Pipes) != 4 {
		t.Fatalf("generated %d and %d pipes; want four", len(first.State.Pipes), len(second.State.Pipes))
	}
	for i, pipe := range first.State.Pipes {
		if pipe.ChallengeID != "intro-steady" || pipe.ChallengeStep == nil || *pipe.ChallengeStep != int64(i) {
			t.Fatalf("pipe %d challenge=(%q,%v), want intro-steady step %d", i, pipe.ChallengeID, pipe.ChallengeStep, i)
		}
		if !reflect.DeepEqual(pipe, second.State.Pipes[i]) {
			t.Fatalf("same seed produced different pipe at step %d", i)
		}
	}
}

func TestSteppedChallengeBandsInsertRecoveryAfterPressure(t *testing.T) {
	want := []string{"intro-steady", "cruise-", "cruise-", "pressure-", "recovery-steady", "pressure-", "recovery-steady", "pressure-", "recovery-steady"}
	for block, prefix := range want {
		result, err := GenerateNext(challengeBlockAt(t, int64(block), 0x12345678))
		if err != nil {
			t.Fatal(err)
		}
		got := result.State.Pipes[0].ChallengeID
		if len(prefix) > 0 && prefix[len(prefix)-1] == '-' {
			if len(got) < len(prefix) || got[:len(prefix)] != prefix {
				t.Errorf("block %d family %q; want prefix %q", block, got, prefix)
			}
		} else if got != prefix {
			t.Errorf("block %d family %q; want %q", block, got, prefix)
		}
	}
}

func TestSteppedChallengeFamilyRepeatBoundAcrossSeeds(t *testing.T) {
	for _, seed := range []int64{0, 1, 2, 3, 17, 999, 0xffffffff} {
		ids := make([]string, 80)
		for block := range ids {
			result, err := GenerateNext(challengeBlockAt(t, int64(block), seed))
			if err != nil {
				t.Fatal(err)
			}
			ids[block] = result.State.Pipes[0].ChallengeID
		}
		for i := 2; i < len(ids); i++ {
			if ids[i] == ids[i-1] && ids[i] == ids[i-2] {
				t.Fatalf("seed %d repeats %q three times at block %d", seed, ids[i], i)
			}
		}
	}
}

func TestChallengeConfigCopiesMetadataAndRejectsInvalidFamilyData(t *testing.T) {
	c := PriorDefaultConfiguration()
	id, err := ConfigIDFor(c)
	if err != nil {
		t.Fatal(err)
	}
	s, err := CreateRun(Descriptor{"challenge-copy", 3, PriorSimulationVersion, PriorGeneratorVersion, id}, c)
	if err != nil {
		t.Fatal(err)
	}
	step := *s.Pipes[0].ChallengeStep
	result, err := GenerateNext(s)
	if err != nil {
		t.Fatal(err)
	}
	*result.State.Pipes[0].ChallengeStep = 2
	if *s.Pipes[0].ChallengeStep != step {
		t.Fatal("generated state shares challenge metadata pointer with input")
	}

	bad := PriorDefaultConfiguration()
	bad.Challenges.Families[0].ID = "   "
	if ValidateConfig(bad) == nil {
		t.Fatal("whitespace-only family ID accepted")
	}
	bad = PriorDefaultConfiguration()
	bad.Challenges.Families[0].GapCenters[0] = 320000
	if ValidateConfig(bad) == nil {
		t.Fatal("intro family outside initial lead-in accepted")
	}
	bad = PriorDefaultConfiguration()
	for i := range bad.Challenges.Families {
		if bad.Challenges.Families[i].ID == "recovery-steady" {
			bad.Challenges.Families[i].GapCenters = []int64{280000, 240000, 200000, 190000}
		}
	}
	if ValidateConfig(bad) == nil {
		t.Fatal("invalid recovery-to-pressure boundary accepted")
	}
}

func TestPressureFamiliesRequireDifferentSafeVerticalLanes(t *testing.T) {
	c := PriorDefaultConfiguration()
	set := c.Challenges
	minCenter, maxCenter := int64(1<<62), int64(0)
	for _, id := range set.PressureFamilyIDs {
		for _, family := range set.Families {
			if family.ID == id {
				for _, center := range family.GapCenters {
					if center < minCenter {
						minCenter = center
					}
					if center > maxCenter {
						maxCenter = center
					}
				}
			}
		}
	}
	margin := c.Pipes.GapHeight/2 - c.Flight.DuckHalfHeight
	if minCenter+margin >= maxCenter-margin {
		t.Fatalf("pressure catalog has common safe lane [%d,%d]", maxCenter-margin, minCenter+margin)
	}
}

func TestEverySelectableFamilyTransitionHasBoundedPhysicsWitness(t *testing.T) {
	c := PriorDefaultConfiguration()
	set := c.Challenges
	families := map[string]ChallengeFamily{}
	for _, family := range set.Families {
		families[family.ID] = family
	}
	edges := [][2]string{}
	for _, id := range set.CruiseFamilyIDs {
		edges = append(edges, [2]string{set.IntroFamilyID, id})
	}
	for i, id := range set.CruiseFamilyIDs {
		edges = append(edges, [2]string{id, set.CruiseFamilyIDs[(i+1)%len(set.CruiseFamilyIDs)]})
		for _, pressure := range set.PressureFamilyIDs {
			edges = append(edges, [2]string{id, pressure})
		}
	}
	for _, pressure := range set.PressureFamilyIDs {
		edges = append(edges, [2]string{pressure, set.RecoveryFamilyID}, [2]string{set.RecoveryFamilyID, pressure})
	}
	if len(edges) != 26 {
		t.Fatalf("selectable edges=%d, want26", len(edges))
	}
	const observationX, collisionEntryX, heldLaneTicks = int64(360000), int64(138000), int64(18)
	speed, err := WorldSpeedAt(c, 2701)
	if err != nil || speed != 4800 {
		t.Fatalf("reaction witness speed=%d err=%v, want speed cap 4800", speed, err)
	}
	availableTicks := float64(observationX-collisionEntryX) / float64(speed)
	if math.Abs(availableTicks-46.25) > 0.000001 || float64(heldLaneTicks) >= availableTicks {
		t.Fatalf("reaction witness lead %.2f ticks must exceed held-lane delay %d", availableTicks, heldLaneTicks)
	}
	entryOffsets, entryVelocities := []int64{-5000, 0, 5000}, []int64{-500, 0, 500}
	for _, edge := range edges {
		for _, offset := range entryOffsets {
			for _, vy := range entryVelocities {
				id, err := ConfigIDFor(c)
				if err != nil {
					t.Fatal(err)
				}
				state, err := CreateRun(Descriptor{"transition-witness", 1, PriorSimulationVersion, PriorGeneratorVersion, id}, c)
				if err != nil {
					t.Fatal(err)
				}
				state.Phase, state.Tick = Running, 2700
				state.Duck.Y = families[edge[0]].GapCenters[3] + offset
				state.Duck.VY = vy
				state.Pipes = make([]Pipe, 8)
				for i := range state.Pipes {
					center := int64(280000)
					if i < 4 {
						center = families[edge[1]].GapCenters[i]
					}
					state.Pipes[i] = Pipe{ID: fmt.Sprintf("witness-%d", i), Index: int64(i), X: 360000 + int64(i)*c.Pipes.Spacing, GapCenter: center}
				}
				state.NextPipeIndex, state.LastGapCenter, state.NextSpawnPipeIndex = 8, 280000, 8
				var sequence int64
				for ticks := 0; ticks < 1000 && state.Score < 4 && state.Phase != Dead; ticks++ {
					active := state.Pipes[len(state.Pipes)-1]
					for _, pipe := range state.Pipes {
						if pipe.X >= state.Duck.X {
							active = pipe
							break
						}
					}
					target := active.GapCenter
					if state.Tick+1 <= 2718 {
						target = families[edge[0]].GapCenters[3]
					}
					inputs := []Input{}
					if state.Duck.Y > target+24000 {
						inputs = append(inputs, Input{sequence, "FLAP"})
						sequence++
					}
					result, e := Step(state, inputs)
					if e != nil {
						t.Fatalf("%s -> %s: %v", edge[0], edge[1], e)
					}
					state = result.State
				}
				if state.Score != 4 {
					t.Errorf("%s -> %s entry=(%d,%d) ended phase=%s score=%d", edge[0], edge[1], offset, vy, state.Phase, state.Score)
				}
			}
		}
	}
}

func TestDefaultChallengeSeedCorpus(t *testing.T) {
	transitions := map[string]bool{}
	survived := 0
	for seed := int64(0); seed < 64; seed++ {
		c := PriorDefaultConfiguration()
		id, err := ConfigIDFor(c)
		if err != nil {
			t.Fatal(err)
		}
		state, err := CreateRun(Descriptor{fmt.Sprintf("challenge-corpus-%d", seed), seed, PriorSimulationVersion, PriorGeneratorVersion, id}, c)
		if err != nil {
			t.Fatal(err)
		}
		var sequence int64
		previous := ""
		observedTarget := int64(280000)
		runTransitions := map[string]bool{}
		for tick := 0; tick < 5000 && state.Phase != Dead; tick++ {
			active := state.Pipes[len(state.Pipes)-1]
			for _, pipe := range state.Pipes {
				if pipe.X >= state.Duck.X {
					active = pipe
					break
				}
			}
			if active.X <= 360000 {
				observedTarget = active.GapCenter
			}
			if active.ChallengeID != "" && active.ChallengeID != previous {
				if previous != "" {
					runTransitions[previous+">"+active.ChallengeID] = true
				}
				previous = active.ChallengeID
			}
			inputs := []Input{}
			if state.Phase == Ready || state.Duck.Y > observedTarget+24000 {
				inputs = append(inputs, Input{sequence, "FLAP"})
				sequence++
			}
			result, e := Step(state, inputs)
			if e != nil {
				t.Fatal(e)
			}
			state = result.State
		}
		if state.Phase != Dead {
			survived++
			for transition := range runTransitions {
				transitions[transition] = true
			}
		}
	}
	if survived != 64 || len(transitions) != 26 {
		t.Fatalf("seed corpus survived=%d/64 transitions=%d/26", survived, len(transitions))
	}
}
