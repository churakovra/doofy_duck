package simulation

import (
	"fmt"
	"strings"
)

func Mix32(x uint32) uint32 {
	x ^= x >> 16
	x *= 0x85ebca6b
	x ^= x >> 13
	x *= 0xc2b2ae35
	x ^= x >> 16
	return x
}

func validateDescriptor(d Descriptor) error {
	if d.Seed < 0 || d.Seed > 4294967295 {
		return fmt.Errorf("invalid seed")
	}
	if strings.TrimSpace(d.RunID) == "" || d.SimulationVersion != SimulationVersion || d.GeneratorVersion != GeneratorVersion || d.ConfigID == "" {
		return fmt.Errorf("invalid descriptor")
	}
	return nil
}

func inc(v, n int64) (int64, error) {
	if v < 0 || n < 0 || v > MaxCounter-n {
		return 0, fmt.Errorf("simulation counter limit exceeded")
	}
	return v + n, nil
}
func cloneConfig(c Config) Config {
	c.Collectibles = append([]Definition{}, c.Collectibles...)
	return c
}
func cloneTotals(totals map[string]int64) map[string]int64 {
	out := make(map[string]int64, len(totals))
	for key, value := range totals {
		out[key] = value
	}
	return out
}
func cloneState(s State) State {
	s.Config = cloneConfig(s.Config)
	s.Pipes = append([]Pipe{}, s.Pipes...)
	s.Collectibles = append([]Collectible{}, s.Collectibles...)
	s.InputHistory = append([]Input{}, s.InputHistory...)
	totals := make(map[string]int64, len(s.Totals))
	for k, v := range s.Totals {
		totals[k] = v
	}
	s.Totals = totals
	return s
}
func ValidateConfig(c Config) error {
	if c.Collectibles == nil {
		return fmt.Errorf("limits and collectible definitions are required")
	}
	f, p := c.Flight, c.Pipes
	numericValues := []int64{f.Gravity, f.FlapVelocity, f.MaxFallSpeed, f.DuckX, f.DuckHalfWidth, f.DuckHalfHeight, p.Speed, p.MaxSpeed, p.RampTicks, p.SpeedEveryPipes, p.SpeedStepPercent, p.GapMinCenter, p.GapMaxCenter, p.MaxGapDelta, p.Spacing, p.Width, p.GapHeight, p.SafeLeadIn, p.Horizon, p.FloorY, p.CeilingY, c.Limits.MaxActivePipes, c.Limits.MaxActiveCollectibles, c.SpawnNoneWeight}
	for _, definition := range c.Collectibles {
		numericValues = append(numericValues, definition.Version, definition.Weight, definition.MinPipeIndex, definition.MinSpacingPipes, definition.Amount, definition.Radius)
	}
	for _, value := range numericValues {
		if value < -maxSafeInteger || value > maxSafeInteger {
			return fmt.Errorf("config number outside safe integer domain")
		}
	}
	if f.DuckHalfWidth <= 0 || f.DuckHalfHeight <= 0 {
		return fmt.Errorf("duck geometry")
	}
	if f.Gravity <= 0 || f.FlapVelocity >= 0 || f.MaxFallSpeed <= 0 || f.FlapVelocity < -f.MaxFallSpeed {
		return fmt.Errorf("flight")
	}
	vals := []int64{f.Gravity, f.FlapVelocity, f.MaxFallSpeed, f.DuckX, f.DuckHalfWidth, f.DuckHalfHeight, p.Speed, p.MaxSpeed, p.RampTicks, p.SpeedEveryPipes, p.SpeedStepPercent, p.GapMinCenter, p.GapMaxCenter, p.MaxGapDelta, p.Spacing, p.Width, p.GapHeight, p.SafeLeadIn, p.Horizon, p.FloorY, p.CeilingY}
	for _, v := range vals {
		if v < -10000000 || v > 10000000 {
			return fmt.Errorf("config bound")
		}
	}
	if p.Speed <= 0 || p.MaxSpeed < p.Speed || p.RampTicks <= 0 || (p.MaxSpeed-p.Speed)*p.RampTicks > maxSafeInteger || p.SpeedEveryPipes <= 0 || p.SpeedStepPercent < 0 || p.GapMinCenter > p.GapMaxCenter || p.MaxGapDelta <= 0 || p.GapMinCenter-p.GapHeight/2 < p.CeilingY || p.GapMaxCenter+p.GapHeight/2 > p.FloorY || p.Spacing <= 0 || p.Width < p.MaxSpeed || p.Width <= 0 || p.GapHeight <= 2*f.DuckHalfHeight || p.Horizon < p.SafeLeadIn || p.FloorY <= p.CeilingY+p.GapHeight {
		return fmt.Errorf("invalid pipe geometry")
	}
	if c.Limits.MaxActivePipes < 2 || c.Limits.MaxActiveCollectibles < 0 || c.SpawnNoneWeight < 0 {
		return fmt.Errorf("config limits")
	}
	seen := map[string]bool{}
	total := c.SpawnNoneWeight
	for _, d := range c.Collectibles {
		if d.TypeID == "" || seen[d.TypeID] || d.Version < 1 || d.Weight < 0 || d.MinPipeIndex < 0 || d.MinSpacingPipes < 0 || d.Amount <= 0 || d.Radius <= 0 || d.Radius >= p.GapHeight/2 || d.Radius+f.DuckHalfHeight+2 >= p.GapHeight/2 || d.Appearance == "" {
			return fmt.Errorf("invalid collectible definition")
		}
		seen[d.TypeID] = true
		if total > maxSafeInteger-d.Weight {
			return fmt.Errorf("weights")
		}
		total += d.Weight
	}
	if total <= 0 || total > maxSafeInteger {
		return fmt.Errorf("spawn table")
	}
	return nil
}
