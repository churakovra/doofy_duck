package simulation

import "fmt"

func CreateRun(d Descriptor, configurations ...Config) (State, error) {
	if e := validateDescriptor(d); e != nil {
		return State{}, e
	}
	if len(configurations) > 1 {
		return State{}, fmt.Errorf("at most one config is accepted")
	}
	var c Config
	if len(configurations) == 1 {
		c = configurations[0]
	} else if d.ConfigID == DefaultConfigID {
		c = DefaultConfiguration()
	} else if d.ConfigID == LegacyDefaultConfigID {
		c = LegacyDefaultConfiguration()
	} else {
		return State{}, fmt.Errorf("custom config is required")
	}
	if e := ValidateConfig(c); e != nil {
		return State{}, e
	}
	id, e := ConfigIDFor(c)
	if e != nil || d.ConfigID != id {
		return State{}, fmt.Errorf("configId mismatch")
	}
	s := State{Descriptor: d, Config: cloneConfig(c), Phase: Ready, Duck: Duck{X: c.Flight.DuckX, Y: floorHalf(c.Pipes.FloorY + c.Pipes.CeilingY)}, Pipes: []Pipe{}, Collectibles: []Collectible{}, Totals: map[string]int64{}, RNGState: uint32(d.Seed), LastGapCenter: floorHalf(c.Pipes.GapMinCenter + c.Pipes.GapMaxCenter), LastCollectiblePipe: -1000000, InputHistory: []Input{}}
	if c.StarSchedule != nil {
		s.NextStarPipeIndex = starInterval(uint32(d.Seed), 0, c.StarSchedule.MinIntervalPipes, c.StarSchedule.MaxIntervalPipes)
		ordinal := int64(0)
		s.StarScheduleOrdinal = &ordinal
	}
	r, e := GenerateNext(s)
	return r.State, e
}
func starInterval(seed uint32, ordinal, minimum, maximum int64) int64 {
	sample := Mix32(seed ^ uint32(ordinal+1)*uint32(0x27d4eb2d))
	return minimum + int64(sample)%(maximum-minimum+1)
}
func GenerateNext(s State) (Result, error) {
	s = cloneState(s)
	pipes := append([]Pipe{}, s.Pipes...)
	rng, index := s.RNGState, s.NextPipeIndex
	previousGap := s.LastGapCenter
	challenge := s.Config.Challenges
	challengeFamilies := map[string]ChallengeFamily{}
	if challenge != nil {
		for _, family := range challenge.Families {
			challengeFamilies[family.ID] = family
		}
	}
	x := s.Config.Pipes.SafeLeadIn
	if len(pipes) > 0 {
		x = pipes[len(pipes)-1].X + s.Config.Pipes.Spacing
	}
	for int64(len(pipes)) < s.Config.Limits.MaxActivePipes && x <= s.Config.Pipes.Horizon {
		rng += 0x9e3779b9
		p := s.Config.Pipes
		raw := p.GapMinCenter + int64(Mix32(uint32(s.Descriptor.Seed)^uint32(index+1)*uint32(0x9e3779b9)))%(p.GapMaxCenter-p.GapMinCenter+1)
		challengeID := ""
		challengeStep := int64(0)
		if challenge != nil {
			challengeStep = index % challenge.PipesPerFamily
			block := index / challenge.PipesPerFamily
			if block == 0 {
				challengeID = challenge.IntroFamilyID
			} else if block <= 2 {
				scheduled := block - 1
				offset := int64(Mix32(uint32(s.Descriptor.Seed)^uint32(0x9e3779b9))) % int64(len(challenge.CruiseFamilyIDs))
				challengeID = challenge.CruiseFamilyIDs[(offset+scheduled)%int64(len(challenge.CruiseFamilyIDs))]
			} else if (block-3)%2 == 0 {
				cycle := (block - 3) / 2
				offset := int64(Mix32(uint32(s.Descriptor.Seed)^uint32(cycle+1)*uint32(0x85ebca6b))) % int64(len(challenge.PressureFamilyIDs))
				challengeID = challenge.PressureFamilyIDs[offset]
			} else {
				challengeID = challenge.RecoveryFamilyID
			}
			raw = challengeFamilies[challengeID].GapCenters[challengeStep]
		}
		lo, hi := previousGap-p.MaxGapDelta, previousGap+p.MaxGapDelta
		if index == 0 {
			lo, hi = previousGap-35000, previousGap+35000
		}
		lo, hi = max64(lo, p.GapMinCenter), min64(hi, p.GapMaxCenter)
		gap := max64(lo, min64(hi, raw))
		previousGap = gap
		var challengeStepPointer *int64
		if challengeID != "" {
			value := challengeStep
			challengeStepPointer = &value
		}
		pipes = append(pipes, Pipe{ID: fmt.Sprintf("pipe-%d", index), Index: index, X: x, GapCenter: gap, ChallengeID: challengeID, ChallengeStep: challengeStepPointer})
		var e error
		index, e = inc(index, 1)
		if e != nil {
			return Result{}, e
		}
		x += s.Config.Pipes.Spacing
	}
	s.Pipes = pipes
	s.RNGState = rng
	s.NextPipeIndex = index
	s.LastGapCenter = previousGap
	return Result{State: s, Events: []Event{}}, nil
}
func WorldSpeedAt(config Config, tick int64, scores ...int64) (int64, error) {
	if err := ValidateConfig(config); err != nil {
		return 0, err
	}
	if len(scores) > 1 {
		return 0, fmt.Errorf("at most one score is accepted")
	}
	score := int64(0)
	if len(scores) == 1 {
		score = scores[0]
	}
	if tick > MaxCounter || score < 0 || score > MaxCounter {
		return 0, fmt.Errorf("invalid score")
	}
	elapsed := int64(0)
	if tick > 1 {
		elapsed = tick - 1
	}
	if elapsed > config.Pipes.RampTicks {
		elapsed = config.Pipes.RampTicks
	}
	delta := config.Pipes.MaxSpeed - config.Pipes.Speed
	base := config.Pipes.Speed + delta*elapsed/config.Pipes.RampTicks
	if config.Pipes.SpeedStepPercent == 0 {
		return base, nil
	}
	denominator := config.Pipes.Speed * config.Pipes.SpeedStepPercent
	maxSteps := ((config.Pipes.MaxSpeed-base)*100 + denominator - 1) / denominator
	steps := score / config.Pipes.SpeedEveryPipes
	if steps > maxSteps {
		steps = maxSteps
	}
	return min64(config.Pipes.MaxSpeed, base+config.Pipes.Speed*steps*config.Pipes.SpeedStepPercent/100), nil
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func floorHalf(value int64) int64 {
	quotient := value / 2
	if value < 0 && value%2 != 0 {
		quotient--
	}
	return quotient
}
func bonusY(c Config, seed uint32, pipe Pipe, radius int64) int64 {
	p, f := c.Pipes, c.Flight
	half := p.GapHeight / 2
	low := max64(pipe.GapCenter-half+f.DuckHalfHeight+radius+2, pipe.GapCenter-half*7/10)
	high := min64(pipe.GapCenter+half-f.DuckHalfHeight-radius-2, pipe.GapCenter+half*7/10)
	if low >= high {
		return floorHalf(pipe.GapCenter - half + f.DuckHalfHeight + pipe.GapCenter + half - f.DuckHalfHeight)
	}
	sample := Mix32(seed ^ uint32(pipe.Index+1)*uint32(0x85ebca6b))
	maxOffset := min64(42000, (high-low)/2)
	magnitude := int64(16000) + int64(sample)%max64(1, maxOffset-15999)
	signed := magnitude
	if sample&0x80000000 != 0 {
		signed = -signed
	}
	return max64(low, min64(high, pipe.GapCenter+signed))
}
func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
