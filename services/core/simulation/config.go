package simulation

import (
	"fmt"
	"strings"
)

func variedRecoveryCentersValid(p PipeConfig) bool {
	offset := p.GapMinCenter - 78000
	for _, recipe := range [][]int64{{100000, 220000, 340000, 460000}, {430000, 310000, 190000, 78000}} {
		for i, base := range recipe {
			center := base + offset
			if center < p.GapMinCenter || center > p.GapMaxCenter || i > 0 && abs(center-(recipe[i-1]+offset)) > p.MaxGapDelta {
				return false
			}
		}
	}
	return true
}

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
	currentRules := d.SimulationVersion == SimulationVersion && d.GeneratorVersion == GeneratorVersion
	pairedRules := d.SimulationVersion == PairedRoutesSimulationVersion && d.GeneratorVersion == PairedRoutesGeneratorVersion
	variedRules := d.SimulationVersion == VariedObstacleSimulationVersion && d.GeneratorVersion == VariedObstacleGeneratorVersion
	priorRules := d.SimulationVersion == PriorSimulationVersion && d.GeneratorVersion == PriorGeneratorVersion
	legacyRules := d.SimulationVersion == LegacySimulationVersion && d.GeneratorVersion == LegacyGeneratorVersion
	wetlandRules := d.SimulationVersion == WetlandSimulationVersion && d.GeneratorVersion == WetlandGeneratorVersion
	customConfig := strings.HasPrefix(d.ConfigID, "dd-v1-config:") && len(d.ConfigID) > len("dd-v1-config:")
	if strings.TrimSpace(d.RunID) == "" || !(currentRules || pairedRules || variedRules || wetlandRules || priorRules || legacyRules) ||
		!(d.ConfigID == DefaultConfigID || d.ConfigID == PairedRoutesConfigID || d.ConfigID == VariedObstacleDefaultConfigID || d.ConfigID == WetlandDefaultConfigID || d.ConfigID == PriorDefaultConfigID || d.ConfigID == LegacyDefaultConfigID || customConfig) ||
		(d.ConfigID == DefaultConfigID && !currentRules) || (d.ConfigID == PairedRoutesConfigID && !pairedRules) || (d.ConfigID == VariedObstacleDefaultConfigID && !variedRules) || (d.ConfigID == PriorDefaultConfigID && !priorRules) || (d.ConfigID == LegacyDefaultConfigID && !legacyRules) {
		return fmt.Errorf("invalid descriptor")
	}
	if d.ConfigID == WetlandDefaultConfigID && !wetlandRules {
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
	if c.StarSchedule != nil {
		schedule := *c.StarSchedule
		c.StarSchedule = &schedule
	}
	if c.Wetland != nil {
		wetland := *c.Wetland
		if wetland.Geometry != nil {
			geometry := *wetland.Geometry
			wetland.Geometry = &geometry
		}
		wetland.StationSpacing = append([]int64{}, c.Wetland.StationSpacing...)
		if c.Wetland.IntroLaneCenters != nil {
			wetland.IntroLaneCenters = append([]int64{}, c.Wetland.IntroLaneCenters...)
		}
		wetland.IntroFamilies = append([]string{}, c.Wetland.IntroFamilies...)
		wetland.PressureFamilies = append([]string{}, c.Wetland.PressureFamilies...)
		wetland.Families = append([]WetlandFamily{}, c.Wetland.Families...)
		for i := range wetland.Families {
			wetland.Families[i].GapCenters = append([]int64{}, c.Wetland.Families[i].GapCenters...)
			wetland.Families[i].ObstacleTypes = append([]string{}, c.Wetland.Families[i].ObstacleTypes...)
			wetland.Families[i].StationSpacing = append([]int64{}, c.Wetland.Families[i].StationSpacing...)
			wetland.Families[i].RewardRoute = append([]WetlandRewardPoint{}, c.Wetland.Families[i].RewardRoute...)
		}
		c.Wetland = &wetland
	}
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
	if s.NextPipeX != nil {
		x := *s.NextPipeX
		s.NextPipeX = &x
	}
	if s.StarScheduleOrdinal != nil {
		ordinal := *s.StarScheduleOrdinal
		s.StarScheduleOrdinal = &ordinal
	}
	s.Pipes = append([]Pipe{}, s.Pipes...)
	for i := range s.Pipes {
		if s.Pipes[i].StationStep != nil {
			value := *s.Pipes[i].StationStep
			s.Pipes[i].StationStep = &value
		}
		if s.Pipes[i].StationSpacing != nil {
			value := *s.Pipes[i].StationSpacing
			s.Pipes[i].StationSpacing = &value
		}
		s.Pipes[i].Obstacles = append([]ObstacleDefinition{}, s.Pipes[i].Obstacles...)
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
	if c.StarSchedule != nil {
		numericValues = append(numericValues, c.StarSchedule.MinIntervalPipes, c.StarSchedule.MaxIntervalPipes)
	}
	if c.Wetland != nil {
		w := c.Wetland
		numericValues = append(numericValues, w.CatalogVersion)
		numericValues = append(numericValues, w.StationSpacing...)
		numericValues = append(numericValues, w.IntroLaneCenters...)
		numericValues = append(numericValues, w.RecoverySpacing, w.StarRoute.XOffset, w.StarRoute.YOffset)
		if w.Geometry != nil {
			numericValues = append(numericValues, w.Geometry.HalfPipeMinPercent, w.Geometry.HalfPipeMaxPercent,
				w.Geometry.FloatingBarMinWidth, w.Geometry.FloatingBarMaxWidth, w.Geometry.FloatingBarHeight)
		}
		for _, family := range w.Families {
			numericValues = append(numericValues, family.GapCenters...)
			numericValues = append(numericValues, family.StationSpacing...)
			for _, point := range family.RewardRoute {
				numericValues = append(numericValues, point.XOffset, point.YOffset)
			}
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
	if schedule := c.StarSchedule; schedule != nil {
		stationMinSpacing := p.Spacing
		if c.Wetland != nil && len(c.Wetland.StationSpacing) > 0 {
			stationMinSpacing = c.Wetland.StationSpacing[0]
			for _, spacing := range c.Wetland.StationSpacing[1:] {
				stationMinSpacing = min64(stationMinSpacing, spacing)
			}
		}
		starDefinition := -1
		for i := range c.Collectibles {
			if c.Collectibles[i].TypeID == "GAME_STAR" {
				starDefinition = i
				break
			}
		}
		if schedule.MinIntervalPipes < 8 || schedule.MaxIntervalPipes < schedule.MinIntervalPipes || schedule.MaxIntervalPipes > 16 ||
			starDefinition < 0 || c.Collectibles[starDefinition].Weight != 0 || c.Limits.MaxActiveCollectibles < 3 ||
			stationMinSpacing > maxSafeInteger/schedule.MinIntervalPipes || stationMinSpacing*schedule.MinIntervalPipes <= p.Horizon+c.Collectibles[starDefinition].Radius+p.MaxSpeed {
			return fmt.Errorf("invalid scheduled Star capacity or interval geometry")
		}
	}
	if wetland := c.Wetland; wetland != nil {
		if c.Challenges != nil {
			return fmt.Errorf("wetland and legacy challenge modes are mutually exclusive")
		}
		if (wetland.CatalogVersion != 1 && wetland.CatalogVersion != 2 && wetland.CatalogVersion != 3 && wetland.CatalogVersion != 4) || len(wetland.StationSpacing) != 3 || wetland.RecoverySpacing != 360000 || len(wetland.IntroFamilies) != 2 || len(wetland.PressureFamilies) != 3 || len(wetland.Families) != 5 {
			return fmt.Errorf("wetland catalog")
		}
		if wetland.CatalogVersion == 1 {
			if wetland.Geometry != nil || wetland.IntroLaneCenters != nil {
				return fmt.Errorf("legacy wetland catalog cannot contain varied geometry")
			}
		} else if wetland.CatalogVersion == 2 {
			g := wetland.Geometry
			if g == nil || g.HalfPipeMinPercent < 70 || g.HalfPipeMinPercent > 88 || !variedRecoveryCentersValid(p) ||
				g.HalfPipeMaxPercent < g.HalfPipeMinPercent || g.HalfPipeMaxPercent > 90 ||
				g.FloatingBarMinWidth != 90000 || g.FloatingBarMaxWidth != 216000 || g.FloatingBarHeight != 42000 ||
				len(wetland.IntroLaneCenters) != 4 {
				return fmt.Errorf("wetland varied geometry bounds")
			}
			for i, center := range wetland.IntroLaneCenters {
				if center < p.GapMinCenter || center > p.GapMaxCenter || i > 0 && abs(center-wetland.IntroLaneCenters[i-1]) > p.MaxGapDelta {
					return fmt.Errorf("wetland intro lane bounds")
				}
			}
		} else if wetland.Geometry != nil || wetland.IntroLaneCenters != nil {
			return fmt.Errorf("paired wetland catalog cannot contain varied geometry")
		}
		if strings.Join(wetland.IntroFamilies, ",") != "steady,quick-pairs" || strings.Join(wetland.PressureFamilies, ",") != "dive-climb,climb-dive,slalom" {
			return fmt.Errorf("wetland families")
		}
		spacingAllowed := func(value int64) bool { return value == 240000 || value == 300000 || value == 360000 }
		minimumCapacity := c.Limits.MaxActivePipes
		if wetland.CatalogVersion == 4 {
			minimumCapacity = c.Limits.MaxActivePipes * 3
			if c.StarSchedule != nil {
				minimumCapacity += 5
			}
		}
		if wetland.StationSpacing[0] != 240000 || wetland.StationSpacing[1] != 300000 || wetland.StationSpacing[2] != 360000 || c.Limits.MaxActiveCollectibles < 10 || c.Limits.MaxActiveCollectibles < minimumCapacity {
			return fmt.Errorf("wetland capacity or approved station spacing")
		}
		requiredCollectibleCapacity := c.Limits.MaxActivePipes
		if c.StarSchedule != nil {
			if requiredCollectibleCapacity >= maxSafeInteger {
				return fmt.Errorf("wetland collectible capacity counter overflow")
			}
			requiredCollectibleCapacity++
		}
		if c.Limits.MaxActiveCollectibles < requiredCollectibleCapacity {
			return fmt.Errorf("wetland Star capacity")
		}
		featherRadius := int64(0)
		for _, definition := range c.Collectibles {
			if definition.TypeID == "FEATHER" {
				featherRadius = definition.Radius
				break
			}
		}
		if featherRadius == 0 {
			return fmt.Errorf("wetland FEATHER definition missing")
		}
		obstacleTypes := map[string]bool{}
		for _, spacing := range wetland.StationSpacing {
			if spacing <= 0 {
				return fmt.Errorf("wetland spacing")
			}
		}
		families := map[string]WetlandFamily{}
		for _, family := range wetland.Families {
			if len(family.GapCenters) != 4 || len(family.ObstacleTypes) != 4 || len(family.StationSpacing) != 4 || len(family.RewardRoute) != 4 {
				return fmt.Errorf("wetland family geometry")
			}
			for _, point := range family.RewardRoute {
				if point.XOffset == 0 || abs(point.XOffset) > 120000 || point.YOffset < -70000 || point.YOffset > 70000 {
					return fmt.Errorf("wetland reward route point")
				}
			}
			for i, center := range family.GapCenters {
				if center < p.GapMinCenter || center > p.GapMaxCenter || !spacingAllowed(family.StationSpacing[i]) || i > 0 && abs(center-family.GapCenters[i-1]) > p.MaxGapDelta {
					return fmt.Errorf("wetland family bounds")
				}
				if wetland.CatalogVersion >= 3 && (center-p.GapHeight/2 <= p.CeilingY || center+p.GapHeight/2 >= p.FloorY) {
					return fmt.Errorf("paired wetland obstacle geometry must have positive rectangles")
				}
				typeID := family.ObstacleTypes[i]
				if typeID != "pipes" && typeID != "vine" && typeID != "rock" && typeID != "debris" {
					return fmt.Errorf("wetland obstacle type")
				}
				if wetland.CatalogVersion >= 3 && typeID != "pipes" {
					return fmt.Errorf("paired wetland catalog requires pipe obstacles")
				}
				obstacleTypes[typeID] = true
			}
			families[family.ID] = family
		}
		starDefinition := int64(0)
		for _, definition := range c.Collectibles {
			if definition.TypeID == "GAME_STAR" {
				starDefinition = definition.Radius
				break
			}
		}
		if wetland.CatalogVersion == 4 {
			minSpacing := wetland.StationSpacing[0]
			for _, spacing := range wetland.StationSpacing[1:] {
				minSpacing = min64(minSpacing, spacing)
			}
			starSideClearance := int64(44000) + 2*f.DuckHalfWidth + 2*starDefinition + 2
			starLeftBound := int64(44000) + f.DuckHalfWidth + starDefinition + 2
			featherSideClearance := int64(36000) + 2*f.DuckHalfWidth + 2*featherRadius + 2
			if p.GapHeight/2-f.DuckHalfHeight-starDefinition-2 < 22000 ||
				p.GapHeight/2-f.DuckHalfHeight-featherRadius-2 < 15000 ||
				minSpacing-p.Width < starSideClearance || minSpacing-p.Width < featherSideClearance || p.SafeLeadIn < starLeftBound {
				return fmt.Errorf("currency formation clearance")
			}
		}
		if wetland.StarRoute.XOffset <= 0 || wetland.StarRoute.XOffset > 120000 || wetland.StarRoute.YOffset <= 0 || wetland.StarRoute.YOffset > 70000 {
			return fmt.Errorf("wetland Star route bounds")
		}
		for _, family := range wetland.Families {
			for i, typeID := range family.ObstacleTypes {
				if wetland.CatalogVersion == 2 && (!validWetlandRoutePoint(family.RewardRoute[i], false) || !validWetlandRoutePoint(wetland.StarRoute, true)) ||
					wetland.CatalogVersion != 2 && (!validWetlandRoute(c, family.ID, int64(i), family.GapCenters[i], typeID, family.RewardRoute[i], featherRadius, false, 0, int64(i)) ||
						!validWetlandRoute(c, family.ID, int64(i), family.GapCenters[i], typeID, wetland.StarRoute, starDefinition, true, 0, int64(i))) {
					return fmt.Errorf("wetland reward route intersects obstacle or leaves flight bounds")
				}
			}
		}
		if len(families) != 5 {
			return fmt.Errorf("wetland family IDs")
		}
		for _, familyID := range []string{"steady", "quick-pairs", "dive-climb", "climb-dive", "slalom"} {
			if _, exists := families[familyID]; !exists {
				return fmt.Errorf("wetland family IDs")
			}
		}
		if wetland.CatalogVersion >= 3 {
			for _, family := range wetland.Families {
				for _, typeID := range family.ObstacleTypes {
					if typeID != "pipes" {
						return fmt.Errorf("paired wetland catalog requires pipe obstacles")
					}
				}
			}
		} else {
			for _, typeID := range []string{"pipes", "vine", "rock", "debris"} {
				if !obstacleTypes[typeID] {
					return fmt.Errorf("wetland obstacle catalog incomplete")
				}
			}
		}
		boundary := func(from, to WetlandFamily) bool { return abs(to.GapCenters[0]-from.GapCenters[3]) <= p.MaxGapDelta }
		for _, from := range wetland.PressureFamilies {
			for _, to := range wetland.PressureFamilies {
				if from != to && !boundary(families[from], families[to]) {
					return fmt.Errorf("wetland pressure boundary")
				}
			}
			if !boundary(families[from], families["steady"]) || !boundary(families["steady"], families[from]) || !boundary(families["quick-pairs"], families[from]) {
				return fmt.Errorf("wetland family boundary")
			}
		}
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

func validWetlandRoute(c Config, familyID string, step int64, center int64, obstacleType string, point WetlandRewardPoint, radius int64, star bool, seed uint32, index int64) bool {
	if !validWetlandRoutePoint(point, star) {
		return false
	}
	stationStep := step
	pipe := Pipe{X: 0, GapCenter: center, EncounterFamily: familyID, StationStep: &stationStep}
	pipe.Obstacles = wetlandObstacles(obstacleType, center, c, seed, index)
	_, y := wetlandRewardPoint(c, pipe, radius, star)
	if y <= c.Pipes.CeilingY+c.Flight.DuckHalfHeight || y >= c.Pipes.FloorY-c.Flight.DuckHalfHeight {
		return false
	}
	x := point.XOffset
	for _, obstacle := range pipe.Obstacles {
		overlapsX := abs(x-obstacle.XOffset) <= c.Flight.DuckHalfWidth+obstacle.Width/2
		overlapsY := y+c.Flight.DuckHalfHeight >= obstacle.Y && y-c.Flight.DuckHalfHeight <= obstacle.Y+obstacle.Height
		if overlapsX && overlapsY {
			return false
		}
	}
	return true
}

func validWetlandRoutePoint(point WetlandRewardPoint, star bool) bool {
	if star {
		return point.XOffset > 0 && point.XOffset <= 120000 && point.YOffset > 0 && point.YOffset <= 70000
	}
	return point.XOffset != 0 && abs(point.XOffset) <= 120000 && point.YOffset >= -70000 && point.YOffset <= 70000
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
