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
	if c.Challenges != nil {
		challenge := *c.Challenges
		challenge.CruiseFamilyIDs = append([]string{}, c.Challenges.CruiseFamilyIDs...)
		challenge.PressureFamilyIDs = append([]string{}, c.Challenges.PressureFamilyIDs...)
		challenge.Families = append([]ChallengeFamily{}, c.Challenges.Families...)
		for i := range challenge.Families {
			challenge.Families[i].GapCenters = append([]int64{}, c.Challenges.Families[i].GapCenters...)
		}
		c.Challenges = &challenge
	}
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
	for i := range s.Pipes {
		if s.Pipes[i].ChallengeStep != nil {
			value := *s.Pipes[i].ChallengeStep
			s.Pipes[i].ChallengeStep = &value
		}
	}
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
	if c.Challenges != nil {
		set := c.Challenges
		numericValues = append(numericValues, set.PipesPerFamily)
		for _, family := range set.Families {
			numericValues = append(numericValues, family.GapCenters...)
		}
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
	if c.Challenges != nil {
		set := c.Challenges
		if set.PipesPerFamily < 1 || set.PipesPerFamily > 16 || len(set.CruiseFamilyIDs) < 2 || len(set.PressureFamilyIDs) < 1 {
			return fmt.Errorf("challenge set")
		}
		families := map[string]ChallengeFamily{}
		for _, family := range set.Families {
			if strings.TrimSpace(family.ID) == "" || len(family.GapCenters) != int(set.PipesPerFamily) || families[family.ID].ID != "" {
				return fmt.Errorf("challenge family")
			}
			if family.Band != "intro" && family.Band != "cruise" && family.Band != "pressure" && family.Band != "recovery" {
				return fmt.Errorf("challenge band")
			}
			for i, center := range family.GapCenters {
				if center < p.GapMinCenter || center > p.GapMaxCenter || center-p.GapHeight/2 < p.CeilingY || center+p.GapHeight/2 > p.FloorY {
					return fmt.Errorf("challenge geometry")
				}
				if i > 0 && abs(center-family.GapCenters[i-1]) > p.MaxGapDelta {
					return fmt.Errorf("challenge gap delta")
				}
			}
			families[family.ID] = family
		}
		if families[set.IntroFamilyID].Band != "intro" || families[set.RecoveryFamilyID].Band != "recovery" {
			return fmt.Errorf("challenge family references")
		}
		midpoint := floorHalf(p.GapMinCenter + p.GapMaxCenter)
		introFirst := families[set.IntroFamilyID].GapCenters[0]
		if introFirst < max64(p.GapMinCenter, midpoint-35000) || introFirst > min64(p.GapMaxCenter, midpoint+35000) {
			return fmt.Errorf("intro lead-in geometry")
		}
		for _, id := range set.CruiseFamilyIDs {
			if families[id].Band != "cruise" {
				return fmt.Errorf("cruise family reference")
			}
		}
		for _, id := range set.PressureFamilyIDs {
			if families[id].Band != "pressure" {
				return fmt.Errorf("pressure family reference")
			}
		}
		if strings.TrimSpace(set.IntroFamilyID) == "" || strings.TrimSpace(set.RecoveryFamilyID) == "" {
			return fmt.Errorf("empty challenge family reference")
		}
		if len(set.CruiseFamilyIDs) != len(uniqueStrings(set.CruiseFamilyIDs)) || len(set.PressureFamilyIDs) != len(uniqueStrings(set.PressureFamilyIDs)) {
			return fmt.Errorf("duplicate challenge family reference")
		}
		cruise, pressure := []ChallengeFamily{}, []ChallengeFamily{}
		for _, id := range set.CruiseFamilyIDs {
			cruise = append(cruise, families[id])
		}
		for _, id := range set.PressureFamilyIDs {
			pressure = append(pressure, families[id])
		}
		checkBoundaries := func(fromFamilies, toFamilies []ChallengeFamily) bool {
			for _, from := range fromFamilies {
				for _, to := range toFamilies {
					if abs(to.GapCenters[0]-from.GapCenters[len(from.GapCenters)-1]) > p.MaxGapDelta {
						return false
					}
				}
			}
			return true
		}
		validBoundaries := checkBoundaries([]ChallengeFamily{families[set.IntroFamilyID]}, cruise)
		for i, from := range cruise {
			to := cruise[(i+1)%len(cruise)]
			if !checkBoundaries([]ChallengeFamily{from}, append([]ChallengeFamily{to}, pressure...)) {
				validBoundaries = false
			}
		}
		if !validBoundaries ||
			!checkBoundaries(pressure, []ChallengeFamily{families[set.RecoveryFamilyID]}) ||
			!checkBoundaries([]ChallengeFamily{families[set.RecoveryFamilyID]}, pressure) {
			return fmt.Errorf("challenge family boundary gap delta")
		}
	}
	return nil
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
