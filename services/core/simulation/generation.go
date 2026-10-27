package simulation

import "fmt"

func wetlandEncounter(seed uint32, block int64, intro, pressure []string) string {
	if block < int64(len(intro)) {
		return intro[block]
	}
	pressureIndex := (block - int64(len(intro))) / 2
	if (block-int64(len(intro)))%2 == 1 {
		return "steady"
	}
	offset := int64(Mix32(seed^uint32(0x85ebca6b))) % int64(len(pressure))
	return pressure[(offset+pressureIndex)%int64(len(pressure))]
}
func pressureLaneCenter(seed uint32, block int64, c Config) int64 {
	pressureOrdinal := (block - 2) / 2
	topLane := Mix32(seed^uint32(pressureOrdinal+1)*uint32(0x4cf5ad43))&1 == 1
	if topLane {
		return c.Pipes.GapMinCenter
	}
	return c.Pipes.GapMaxCenter
}
func variedWetlandGapCenter(seed uint32, block, step int64, family string, c Config) (int64, bool) {
	w := c.Wetland
	if block == 0 && family == "steady" {
		edge := pressureLaneCenter(seed, 2, c)
		if edge == c.Pipes.GapMinCenter {
			if step == 3 {
				return edge, true
			}
			return c.Pipes.GapMinCenter + c.Pipes.GapMaxCenter - w.IntroLaneCenters[step], true
		}
		if step == 3 {
			return edge, true
		}
		return w.IntroLaneCenters[step], true
	}
	if block == 1 && family == "quick-pairs" {
		return pressureLaneCenter(seed, 2, c), true
	}
	if block >= 2 && block%2 == 0 {
		return pressureLaneCenter(seed, block, c), true
	}
	if block >= 3 && block%2 == 1 && family == "steady" {
		from, to := pressureLaneCenter(seed, block-1, c), pressureLaneCenter(seed, block+1, c)
		if from == to {
			return from, true
		}
		worldOffset := c.Pipes.GapMinCenter - 78000
		if from == c.Pipes.GapMinCenter && to == c.Pipes.GapMaxCenter {
			return []int64{100000, 220000, 340000, 460000}[step] + worldOffset, true
		}
		return []int64{430000, 310000, 190000, 78000}[step] + worldOffset, true
	}
	return 0, false
}

func isCoinCourseBlock(seed uint32, block int64) bool {
	first := int64(2 + 2*(Mix32(seed^uint32(0x6d2b79f5))%3))
	return block >= first && (block-first)%6 == 0
}

const (
	bonusSegmentScheduleSalt uint32 = 0x2c1b3c6d
	bonusSegmentRecipeSalt   uint32 = 0x297a2d39
	bonusSegmentCenterSalt   uint32 = 0x165667b1
	bonusSegmentRecovery     int64  = 360000
	bonusSegmentV2CenterSalt uint32 = 0x7f4a7c15
	bonusSegmentV2RecipeSalt uint32 = 0x6a09e667
	bonusSegmentV2MirrorSalt uint32 = 0x3c6ef372
)

type bonusSegmentRecipe string

const (
	bonusAscent  bonusSegmentRecipe = "shallow-ascent"
	bonusDescent bonusSegmentRecipe = "shallow-descent"
	bonusSlalom  bonusSegmentRecipe = "shallow-slalom"
)

func bonusSegmentSlot(block int64) int64 { return (block - 2) / 3 }

func isBonusSegmentBlock(seed uint32, block int64) bool {
	if block < 2 {
		return false
	}
	slot := bonusSegmentSlot(block)
	selected := int64(2) + slot*3 + int64(Mix32(seed^bonusSegmentScheduleSalt^uint32(slot+1)*bonusSegmentRecipeSalt)%2)
	return block == selected
}

func getBonusSegmentRecipe(seed uint32, block int64) bonusSegmentRecipe {
	if !isBonusSegmentBlock(seed, block) {
		panic("bonus segment recipe requested for an unscheduled block")
	}
	slot := bonusSegmentSlot(block)
	sample := Mix32(seed ^ uint32(slot+1)*bonusSegmentCenterSalt ^ bonusSegmentRecipeSalt)
	return []bonusSegmentRecipe{bonusAscent, bonusDescent, bonusSlalom}[sample%3]
}

func bonusSegmentGapCenter(seed uint32, block, step int64, c Config) int64 {
	slot := bonusSegmentSlot(block)
	sample := Mix32(seed ^ uint32(slot+1)*bonusSegmentCenterSalt)
	center := (c.Pipes.GapMinCenter+c.Pipes.GapMaxCenter)/2 + int64(sample%5001) - 2500
	var offset int64
	switch getBonusSegmentRecipe(seed, block) {
	case bonusAscent:
		if step == 1 {
			offset = -2500
		} else if step == 2 {
			offset = -5000
		}
	case bonusDescent:
		if step == 1 {
			offset = 2500
		} else if step == 2 {
			offset = 5000
		}
	case bonusSlalom:
		if step == 1 {
			offset = 5000
		} else if step == 2 {
			offset = -5000
		}
	}
	return center + offset
}

func isScheduledBonusBlock(c Config, seed uint32, block int64) bool {
	if c.Wetland == nil || c.Wetland.CatalogVersion < 11 {
		return isBonusSegmentBlock(seed, block)
	}
	first := int64(6 + Mix32(seed^uint32(0x243f6a88))%3)
	return block >= first && (block-first)%7 == 0
}

func bonusSegmentV2Recipe(seed uint32, block int64) string {
	if !isBonusSegmentBlock(seed, block) {
		panic("bonus segment recipe requested for an unscheduled block")
	}
	return bonusSegmentV2RecipeUnchecked(seed, block)
}

func bonusSegmentV2RecipeUnchecked(seed uint32, block int64) string {
	slot := bonusSegmentSlot(block)
	sample := Mix32(seed ^ uint32(slot+1)*bonusSegmentV2RecipeSalt ^ bonusSegmentV2CenterSalt)
	return []string{"ascent", "descent", "slalom"}[sample%3]
}

func bonusSegmentV2Offsets(seed uint32, block int64) [3]int64 {
	var offsets [3]int64
	switch bonusSegmentV2RecipeUnchecked(seed, block) {
	case "ascent":
		offsets = [3]int64{0, -40000, -80000}
	case "descent":
		offsets = [3]int64{0, 40000, 80000}
	case "slalom":
		offsets = [3]int64{0, 40000, -40000}
	}
	slot := bonusSegmentSlot(block)
	if Mix32(seed^uint32(slot+1)*bonusSegmentV2MirrorSalt)&1 != 0 {
		for i := range offsets {
			offsets[i] = -offsets[i]
		}
	}
	return offsets
}

func bonusSegmentV2GapCenter(seed uint32, block, step, previous int64, c Config) (int64, error) {
	offsets := bonusSegmentV2Offsets(seed, block)
	if step > 0 {
		return previous + offsets[step] - offsets[step-1], nil
	}
	p := c.Pipes
	minOffset, maxOffset := offsets[0], offsets[0]
	for _, offset := range offsets[1:] {
		minOffset = min64(minOffset, offset)
		maxOffset = max64(maxOffset, offset)
	}
	low := max64(p.GapMinCenter-minOffset, previous-p.MaxGapDelta)
	high := min64(p.GapMaxCenter-maxOffset, previous+p.MaxGapDelta)
	if low > high {
		return 0, fmt.Errorf("bonus segment route has no legal seeded anchor")
	}
	approachLow := max64(low, previous-20000)
	approachHigh := min64(high, previous+20000)
	anchorLow, anchorHigh := low, high
	if approachLow <= approachHigh {
		anchorLow, anchorHigh = approachLow, approachHigh
	}
	slot := bonusSegmentSlot(block)
	sample := Mix32(seed ^ uint32(slot+1)*bonusSegmentV2CenterSalt ^ bonusSegmentV2RecipeSalt)
	anchor := anchorLow + int64(sample)%((anchorHigh-anchorLow)+1)
	return anchor + offsets[step], nil
}

func pressurePipeCenter(seed uint32, index, previous int64, c Config) int64 {
	sample := Mix32(seed ^ uint32(index+1)*uint32(0x68bc21eb))
	magnitude := min64(c.Pipes.MaxGapDelta, 60000+int64(sample%20001))
	direction := int64(-1)
	polarity := Mix32(seed^uint32(index/4+1)*uint32(0x27d4eb2d)) & 1
	if (index+int64(polarity))&1 == 0 {
		direction = 1
	}
	target := previous + direction*magnitude
	if target < c.Pipes.GapMinCenter || target > c.Pipes.GapMaxCenter {
		target = previous - direction*magnitude
	}
	return max64(c.Pipes.GapMinCenter, min64(c.Pipes.GapMaxCenter, target))
}

func irregularBaseCenter(seed uint32, index, previous int64, c Config) int64 {
	p := c.Pipes
	sample := Mix32(seed ^ uint32(index+1)*uint32(0x4cf5ad43))
	magnitude := min64(p.MaxGapDelta, 30000+int64(sample%40001))
	direction := int64(1)
	if sample&0x80000000 != 0 {
		direction = -1
	}
	target := previous + direction*magnitude
	if target < p.GapMinCenter || target > p.GapMaxCenter {
		target = previous - direction*magnitude
	}
	if target < p.GapMinCenter || target > p.GapMaxCenter {
		if previous-p.GapMinCenter >= p.GapMaxCenter-previous {
			target = p.GapMinCenter
		} else {
			target = p.GapMaxCenter
		}
	}
	return target
}

func variedPipeCenter(seed uint32, index, previous int64, recovery bool, c Config) int64 {
	delta := int64(75000)
	if recovery {
		delta = 35000
	}
	delta = min64(delta, c.Pipes.MaxGapDelta)
	low := max64(c.Pipes.GapMinCenter, previous-delta)
	high := min64(c.Pipes.GapMaxCenter, previous+delta)
	sample := Mix32(seed ^ uint32(index+1)*uint32(0x51ed270b))
	return low + int64(sample)%(high-low+1)
}

func bonusSegmentV2OrdinaryCenter(seed uint32, index, previous int64, c Config) int64 {
	low := max64(c.Pipes.GapMinCenter, previous-45000)
	high := min64(c.Pipes.GapMaxCenter, previous+45000)
	sample := Mix32(seed ^ uint32(index+1)*bonusSegmentV2CenterSalt)
	return low + int64(sample)%((high-low)+1)
}

func scaledClearanceSpacing(original, width, percent int64) int64 {
	return width + (original-width)*percent/100
}

func coinCourseGapCenter(seed uint32, block, step int64) int64 {
	first := int64(2 + 2*(Mix32(seed^uint32(0x6d2b79f5))%3))
	ordinal := (block - first) / 6
	sample := Mix32(seed ^ uint32(ordinal+1)*uint32(0x85ebca6b) ^ uint32(0x6d2b79f5))
	center := int64(280000) + int64(sample%30001) - 15000
	direction := int64(1)
	if sample&0x80000000 != 0 {
		direction = -1
	}
	if step == 1 {
		return center + direction*18000
	}
	if step == 2 {
		return center - direction*9000
	}
	return center
}
func wetlandObstacles(typeID string, gapCenter int64, c Config, seed uint32, index int64) []ObstacleDefinition {
	p := c.Pipes
	openingTop, openingBottom := gapCenter-p.GapHeight/2, gapCenter+p.GapHeight/2
	width := p.Width
	switch typeID {
	case "pipes":
		return []ObstacleDefinition{{TypeID: typeID, Y: p.CeilingY, Width: width, Height: openingTop - p.CeilingY}, {TypeID: typeID, Y: openingBottom, Width: width, Height: p.FloorY - openingBottom}}
	case "vine":
		if c.Wetland.CatalogVersion == 1 {
			return []ObstacleDefinition{{TypeID: typeID, Y: p.CeilingY, Width: width, Height: openingTop - p.CeilingY}}
		}
	case "rock":
		if c.Wetland.CatalogVersion == 1 {
			return []ObstacleDefinition{{TypeID: typeID, Y: openingBottom, Width: width, Height: p.FloorY - openingBottom}}
		}
	default:
		if c.Wetland.CatalogVersion == 1 {
			height := int64(42000)
			return []ObstacleDefinition{{TypeID: typeID, Y: gapCenter - height/2, Width: width, Height: height}}
		}
	}
	if c.Wetland.CatalogVersion == 1 {
		return []ObstacleDefinition{{TypeID: typeID, Y: p.FloorY - openingBottom, Width: width, Height: p.FloorY - openingBottom}}
	}
	geometry := c.Wetland.Geometry
	sample := func(salt uint32) uint32 { return Mix32(seed ^ uint32(index+1)*salt) }
	if typeID == "vine" || typeID == "rock" {
		maximum := geometry.HalfPipeMaxPercent
		if typeID == "vine" {
			maximum = min64(88, maximum)
		}
		effectiveMaximum := min64(geometry.HalfPipeMaxPercent, maximum)
		effectiveMinimum := min64(geometry.HalfPipeMinPercent, effectiveMaximum)
		percent := effectiveMinimum + int64(sample(0x27d4eb2d))%(effectiveMaximum-effectiveMinimum+1)
		height := (p.FloorY - p.CeilingY) * percent / 100
		if typeID == "vine" {
			return []ObstacleDefinition{{TypeID: typeID, Y: p.CeilingY, Width: width, Height: height}}
		}
		return []ObstacleDefinition{{TypeID: typeID, Y: p.FloorY - height, Width: width, Height: height}}
	}
	widthSample := sample(0x165667b1)
	widthBucket := widthSample % 64
	barWidth := geometry.FloatingBarMinWidth + int64(widthSample)%(geometry.FloatingBarMaxWidth-geometry.FloatingBarMinWidth+1)
	if widthBucket == 0 {
		barWidth = geometry.FloatingBarMinWidth
	} else if widthBucket == 1 {
		barWidth = geometry.FloatingBarMaxWidth
	}
	minCenter, maxCenter := p.CeilingY+90000, p.FloorY-90000
	center := minCenter + int64(sample(0xd3a2646c))%(maxCenter-minCenter+1)
	return []ObstacleDefinition{{TypeID: typeID, Y: center - geometry.FloatingBarHeight/2, Width: barWidth, Height: geometry.FloatingBarHeight}}
}
func wetlandRewardPoint(c Config, p Pipe, radius int64, star bool) (int64, int64) {
	var authored WetlandRewardPoint
	if star {
		authored = c.Wetland.StarRoute
	} else {
		for _, family := range c.Wetland.Families {
			if family.ID == p.EncounterFamily && p.StationStep != nil {
				authored = family.RewardRoute[*p.StationStep]
				break
			}
		}
	}
	if c.Wetland.CatalogVersion == 2 {
		minY := c.Pipes.CeilingY + c.Flight.DuckHalfHeight + radius + 2
		maxY := c.Pipes.FloorY - c.Flight.DuckHalfHeight - radius - 2
		sign := sign64(authored.YOffset)
		if sign == 0 {
			if p.StationStep != nil && *p.StationStep%2 == 0 {
				sign = -1
			} else {
				sign = 1
			}
		}
		routeSign := sign
		if star {
			routeSign = -sign
		}
		maxObstacleWidth := c.Pipes.Width
		for _, obstacle := range p.Obstacles {
			maxObstacleWidth = max64(maxObstacleWidth, obstacle.Width)
		}
		xSign := sign64(authored.XOffset)
		if star {
			xSign = -1
		} else if xSign == 0 {
			xSign = sign
		}
		xOffset := xSign * min64(120000, max64(abs(authored.XOffset), maxObstacleWidth/2+c.Flight.DuckHalfWidth+radius+8000))
		y := max64(minY, min64(maxY, p.GapCenter+routeSign*abs(authored.YOffset)))
		for _, obstacle := range p.Obstacles {
			if obstacle.TypeID == "pipes" {
				var top, bottom *ObstacleDefinition
				for i := range p.Obstacles {
					item := &p.Obstacles[i]
					if item.Y == c.Pipes.CeilingY {
						top = item
					}
					if item.Y+item.Height == c.Pipes.FloorY {
						bottom = item
					}
				}
				if top != nil && bottom != nil {
					openingTop, openingBottom := top.Y+top.Height, bottom.Y
					safeTop := openingTop + c.Flight.DuckHalfHeight + radius + 2
					safeBottom := openingBottom - c.Flight.DuckHalfHeight - radius - 2
					offset := int64(18000)
					if star {
						offset = 48000
					}
					y = max64(safeTop, min64(safeBottom, p.GapCenter+routeSign*offset))
					if star {
						return p.X + xOffset, y
					}
					return p.X + sign64(authored.XOffset)*abs(authored.XOffset), y
				}
				break
			}
		}
		for _, obstacle := range p.Obstacles {
			if obstacle.TypeID == "vine" {
				freeLow := min64(maxY, obstacle.Y+obstacle.Height+c.Flight.DuckHalfHeight+radius+2)
				coinY := (freeLow + maxY) / 2
				y = coinY
				if star {
					y = min64(maxY, coinY+30000)
				}
				return p.X + xOffset, y
			}
			if obstacle.TypeID == "rock" {
				freeHigh := max64(minY, obstacle.Y-c.Flight.DuckHalfHeight-radius-2)
				coinY := (minY + freeHigh) / 2
				y = coinY
				if star {
					y = max64(minY, coinY-30000)
				}
				return p.X + xOffset, y
			}
			if obstacle.TypeID == "debris" {
				barCenter := obstacle.Y + obstacle.Height/2
				clearance := obstacle.Height/2 + c.Flight.DuckHalfHeight + radius + 18000
				if star {
					y = max64(minY, min64(maxY, barCenter+sign*(clearance+70000)))
				} else {
					y = max64(minY, min64(maxY, barCenter+routeSign*clearance))
				}
				return p.X + xOffset, y
			}
		}
		return p.X + xOffset, y
	}
	debris := false
	for _, obstacle := range p.Obstacles {
		if obstacle.TypeID == "debris" {
			debris = true
			break
		}
	}
	var offset int64
	if debris {
		clearance := int64(21000) + c.Flight.DuckHalfHeight + 1
		minY, maxY := c.Pipes.CeilingY+c.Flight.DuckHalfHeight, c.Pipes.FloorY-c.Flight.DuckHalfHeight
		upperReach, lowerReach := p.GapCenter-minY, maxY-p.GapCenter
		direction := sign64(authored.YOffset)
		if direction > 0 && lowerReach < clearance {
			direction = -1
		}
		if direction < 0 && upperReach < clearance {
			direction = 1
		}
		reach := upperReach
		if direction > 0 {
			reach = lowerReach
		}
		magnitude := authored.YOffset
		if magnitude < 0 {
			magnitude = -magnitude
		}
		offset = direction * max64(clearance, min64(magnitude, reach))
	} else {
		offsetLimit := c.Pipes.GapHeight/2 - c.Flight.DuckHalfHeight - radius - 2
		magnitude := authored.YOffset
		if magnitude < 0 {
			magnitude = -magnitude
		}
		offset = sign64(authored.YOffset) * min64(magnitude, offsetLimit)
	}
	return p.X + authored.XOffset, p.GapCenter + offset
}

func sign64(v int64) int64 {
	if v < 0 {
		return -1
	}
	if v > 0 {
		return 1
	}
	return 0
}

func currencyFormationPoints(c Config, seed uint32, p Pipe, radius int64, star bool, eventOrdinal int64) [][2]int64 {
	x, y := wetlandRewardPoint(c, p, radius, star)
	if c.Wetland != nil && c.Wetland.CatalogVersion == 5 && !star && p.StationStep != nil && *p.StationStep == 2 && isCoinCourseBlock(seed, p.Index/4) {
		safeY := min64(20000, c.Pipes.GapHeight/2-c.Flight.DuckHalfHeight-radius-2)
		if safeY < 1 {
			safeY = 1
		}
		return [][2]int64{{p.X + 70000, y}, {p.X + 100000, y - safeY}, {p.X + 130000, y + safeY}}
	}
	if c.Wetland != nil && c.Wetland.CatalogVersion == 6 {
		if !star && p.StationStep != nil && *p.StationStep == 2 && isBonusSegmentBlock(seed, p.Index/4) {
			spacing := bonusSegmentRecovery + c.Pipes.Width
			if p.StationSpacing != nil {
				spacing = *p.StationSpacing
			}
			centerX := p.X + spacing/2
			return [][2]int64{{centerX - 18000, y}, {centerX + 9000, y - 15000}, {centerX + 9000, y + 15000}}
		}
		if star && c.Wetland.StarFormations != nil && *c.Wetland.StarFormations {
			variant := Mix32(seed ^ uint32(p.Index+1)*uint32(0x9e3779b9) ^ uint32(eventOrdinal+1)*uint32(0x85ebca6b) ^ uint32(0x51ed270b))
			offsets := [][2]int64{{0, -22000}, {21000, -7000}, {13000, 18000}, {-13000, 18000}, {-21000, -7000}}
			rotation := (variant >> 1) & 3
			centerX := p.X + c.Pipes.Width/2
			halfOpening := c.Pipes.GapHeight/2 - c.Flight.DuckHalfHeight - radius - 2
			centerY := max64(p.GapCenter-halfOpening+22000, min64(p.GapCenter+halfOpening-22000, y))
			points := make([][2]int64, len(offsets))
			for i, offset := range offsets {
				dx, dy := rotateFormationOffset(offset[0], offset[1], rotation)
				points[i] = [2]int64{centerX + dx, centerY + dy}
			}
			return points
		}
		if star {
			return [][2]int64{{p.X + c.Pipes.Width/2, y}}
		}
		return [][2]int64{{x, y}}
	}
	if c.Wetland != nil && c.Wetland.CatalogVersion >= 7 {
		if !star && p.StationStep != nil && *p.StationStep == 2 && isScheduledBonusBlock(c, seed, p.Index/4) {
			spacing := bonusSegmentRecovery + c.Pipes.Width
			if p.StationSpacing != nil {
				spacing = *p.StationSpacing
			}
			centerX := p.X + spacing/2
			return [][2]int64{{centerX - 18000, y}, {centerX + 9000, y - 15000}, {centerX + 9000, y + 15000}}
		}
		if star && c.Wetland.StarFormations != nil && *c.Wetland.StarFormations {
			variant := Mix32(seed ^ uint32(p.Index+1)*uint32(0x9e3779b9) ^ uint32(eventOrdinal+1)*uint32(0x85ebca6b) ^ uint32(0x51ed270b))
			offsets := [][2]int64{{0, -22000}, {21000, -7000}, {13000, 18000}, {-13000, 18000}, {-21000, -7000}}
			rotation := (variant >> 1) & 3
			centerX := p.X + c.Pipes.Width/2
			halfOpening := c.Pipes.GapHeight/2 - c.Flight.DuckHalfHeight - radius - 2
			centerY := max64(p.GapCenter-halfOpening+22000, min64(p.GapCenter+halfOpening-22000, y))
			points := make([][2]int64, len(offsets))
			for i, offset := range offsets {
				dx, dy := rotateFormationOffset(offset[0], offset[1], rotation)
				points[i] = [2]int64{centerX + dx, centerY + dy}
			}
			return points
		}
		if star {
			return [][2]int64{{p.X + c.Pipes.Width/2, y}}
		}
		return [][2]int64{{x, y}}
	}
	if c.Wetland == nil || c.Wetland.CatalogVersion < 4 {
		return [][2]int64{{x, y}}
	}
	starSalt := uint32(0)
	if star {
		starSalt = 0x51ed270b
	}
	variant := Mix32(seed ^ uint32(p.Index+1)*uint32(0x9e3779b9) ^ uint32(eventOrdinal+1)*uint32(0x85ebca6b) ^ starSalt)
	halfOpening := c.Pipes.GapHeight/2 - c.Flight.DuckHalfHeight - radius - 2
	yVariation := int64(15000)
	if star {
		yVariation = 22000
	}
	centerY := max64(p.GapCenter-halfOpening+yVariation, min64(p.GapCenter+halfOpening-yVariation, y))
	if star {
		offsets := [][2]int64{{0, -22000}, {21000, -7000}, {13000, 18000}, {-13000, 18000}, {-21000, -7000}}
		points := make([][2]int64, len(offsets))
		rotation := (variant >> 1) & 3
		// Translate the authored center so the rotated group clears one side of the pipe.
		margin := int64(22000) + c.Flight.DuckHalfWidth + radius + 2
		safeCenterX := p.X - margin
		if variant&1 != 0 {
			safeCenterX = p.X + c.Pipes.Width + margin
		}
		centerShiftX := safeCenterX - x
		formationCenterX := x + centerShiftX
		for i, offset := range offsets {
			dx, dy := rotateFormationOffset(offset[0], offset[1], rotation)
			points[i] = [2]int64{formationCenterX + dx, centerY + dy}
		}
		return points
	}
	direction := int64(1)
	if variant&2 != 0 {
		direction = -1
	}
	centerX := p.X + c.Pipes.Width/2
	if variant&1 != 0 {
		margin := int64(18000) + c.Flight.DuckHalfWidth + radius + 2
		if direction < 0 {
			centerX = p.X - margin
		} else {
			centerX = p.X + c.Pipes.Width + margin
		}
	}
	baseY := int64(1)
	if variant&4 != 0 {
		baseY = -1
	}
	// The nose and two vertically separated tail points form a three-member fish.
	return [][2]int64{
		{centerX + direction*18000, centerY},
		{centerX - direction*18000, centerY - baseY*15000},
		{centerX - direction*18000, centerY + baseY*15000},
	}
}

func rotateFormationOffset(x, y int64, quarterTurns uint32) (int64, int64) {
	switch quarterTurns {
	case 1:
		return -y, x
	case 2:
		return -x, -y
	case 3:
		return y, -x
	default:
		return x, y
	}
}

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
		c = VariedBaseConfiguration()
	} else if d.ConfigID == BaseBonusConfigID {
		c = BaseBonusConfiguration()
	} else if d.ConfigID == DensePipesConfigID {
		c = DensePipesConfiguration()
	} else if d.ConfigID == PressurePipesConfigID {
		c = PressurePipesConfiguration()
	} else if d.ConfigID == VariedPipesConfigID {
		c = VariedPipesConfiguration()
	} else if d.ConfigID == BonusSegmentsV2ConfigID {
		c = BonusSegmentsV2Configuration()
	} else if d.ConfigID == BonusSegmentsConfigID {
		c = BonusSegmentsConfiguration()
	} else if d.ConfigID == CoinCourseConfigID {
		c = CoinCourseConfiguration()
	} else if d.ConfigID == CurrencyFormationsConfigID {
		c = CurrencyFormationsConfiguration()
	} else if d.ConfigID == PairedRoutesConfigID {
		c = PairedRoutesConfiguration()
	} else if d.ConfigID == VariedObstacleDefaultConfigID {
		c = VariedObstacleConfiguration()
	} else if d.ConfigID == WetlandDefaultConfigID {
		c = WetlandConfiguration()
	} else if d.ConfigID == PriorDefaultConfigID {
		c = PriorDefaultConfiguration()
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
	if c.Wetland != nil {
		if c.Wetland.CatalogVersion == 2 && (d.SimulationVersion != VariedObstacleSimulationVersion || d.GeneratorVersion != VariedObstacleGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-2 wetland config requires frozen varied-obstacle simulation and generator versions")
		}
		if c.Wetland.CatalogVersion == 3 && (d.SimulationVersion != PairedRoutesSimulationVersion || d.GeneratorVersion != PairedRoutesGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-3 wetland config requires paired-routes simulation and generator versions")
		}
		if c.Wetland.CatalogVersion == 4 && (d.SimulationVersion != CurrencyFormationsSimulationVersion || d.GeneratorVersion != CurrencyFormationsGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-4 wetland config requires currency-formations simulation and generator versions")
		}
		if c.Wetland.CatalogVersion == 5 && (d.SimulationVersion != CoinCourseSimulationVersion || d.GeneratorVersion != CoinCourseGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-5 wetland config requires coin-course simulation and generator versions")
		}
		if c.Wetland.CatalogVersion == 6 && (d.SimulationVersion != BonusSegmentsSimulationVersion || d.GeneratorVersion != BonusSegmentsGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-6 wetland config requires bonus-segments simulation and generator versions")
		}
		if c.Wetland.CatalogVersion == 7 && (d.SimulationVersion != BonusSegmentsV2SimulationVersion || d.GeneratorVersion != BonusSegmentsV2GeneratorVersion) {
			return State{}, fmt.Errorf("catalog-7 wetland config requires bonus-segments-v2 simulation and generator versions")
		}
		if c.Wetland.CatalogVersion == 8 && (d.SimulationVersion != VariedPipesSimulationVersion || d.GeneratorVersion != VariedPipesGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-8 requires varied-pipes versions")
		}
		if c.Wetland.CatalogVersion == 9 && (d.SimulationVersion != PressurePipesSimulationVersion || d.GeneratorVersion != PressurePipesGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-9 requires pressure-pipes versions")
		}
		if c.Wetland.CatalogVersion == 10 && (d.SimulationVersion != DensePipesSimulationVersion || d.GeneratorVersion != DensePipesGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-10 requires dense-pipes versions")
		}
		if c.Wetland.CatalogVersion == 11 && (d.SimulationVersion != BaseBonusSimulationVersion || d.GeneratorVersion != BaseBonusGeneratorVersion) {
			return State{}, fmt.Errorf("catalog-11 requires base-bonus versions")
		}
		if c.Wetland.CatalogVersion == 12 && (d.SimulationVersion != SimulationVersion || d.GeneratorVersion != GeneratorVersion) {
			return State{}, fmt.Errorf("catalog-12 requires varied-base versions")
		}
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
	return generateNextOwned(s)
}

// generateNextOwned advances generation on a state whose slices, maps, and
// configuration are already owned by the caller. Public callers must use
// GenerateNext so their input remains isolated from the returned state.
func generateNextOwned(s State) (Result, error) {
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
	if s.Config.Wetland != nil && s.NextPipeX != nil {
		x = *s.NextPipeX
	} else if len(pipes) > 0 {
		spacing := s.Config.Pipes.Spacing
		if pipes[len(pipes)-1].StationSpacing != nil {
			spacing = *pipes[len(pipes)-1].StationSpacing
		}
		x = pipes[len(pipes)-1].X + spacing
	} else if s.NextPipeX != nil {
		x = *s.NextPipeX
	}
	for int64(len(pipes)) < s.Config.Limits.MaxActivePipes && x <= s.Config.Pipes.Horizon {
		rng += 0x9e3779b9
		p := s.Config.Pipes
		raw := p.GapMinCenter + int64(Mix32(uint32(s.Descriptor.Seed)^uint32(index+1)*uint32(0x9e3779b9)))%(p.GapMaxCenter-p.GapMinCenter+1)
		challengeID := ""
		challengeStep := int64(0)
		stationStep := index % 4
		family := ""
		var stationSpacing *int64
		if wetland := s.Config.Wetland; wetland != nil {
			wetlandBlock := index / 4
			coinCourse := wetland.CatalogVersion == 5 && isCoinCourseBlock(uint32(s.Descriptor.Seed), wetlandBlock)
			bonusSegment := wetland.CatalogVersion == 6 && isBonusSegmentBlock(uint32(s.Descriptor.Seed), wetlandBlock)
			bonusSegmentV2 := wetland.CatalogVersion >= 7 && isScheduledBonusBlock(s.Config, uint32(s.Descriptor.Seed), wetlandBlock)
			if wetland.CatalogVersion >= 11 {
				family = "steady"
			} else {
				family = wetlandEncounter(uint32(s.Descriptor.Seed), wetlandBlock, wetland.IntroFamilies, wetland.PressureFamilies)
			}
			familySpec := WetlandFamily{}
			for _, candidate := range wetland.Families {
				if candidate.ID == family {
					familySpec = candidate
					break
				}
			}
			spacing := familySpec.StationSpacing[stationStep]
			if (wetland.CatalogVersion == 6 || wetland.CatalogVersion >= 7) && family == "steady" && wetlandBlock >= int64(len(wetland.IntroFamilies)) {
				spacing = wetland.RecoverySpacing
			}
			if coinCourse && stationStep < 2 {
				spacing = 180000
			} else if coinCourse && stationStep == 2 {
				spacing = wetland.RecoverySpacing
			} else if bonusSegment && stationStep < 2 {
				spacing = scaledClearanceSpacing(spacing, p.Width, 20)
			} else if bonusSegment && stationStep == 2 {
				spacing = p.Width + bonusSegmentRecovery
			} else if bonusSegmentV2 && stationStep < 2 {
				spacing = scaledClearanceSpacing(spacing, p.Width, 10)
			} else if bonusSegmentV2 && stationStep == 2 {
				spacing = p.Width + bonusSegmentRecovery
			} else if wetland.CatalogVersion == 6 {
				spacing = scaledClearanceSpacing(spacing, p.Width, 70)
			} else if wetland.CatalogVersion >= 7 {
				spacing = scaledClearanceSpacing(spacing, p.Width, 50)
			} else if family == "steady" && wetlandBlock >= int64(len(wetland.IntroFamilies)) {
				spacing = wetland.RecoverySpacing
			}
			if wetland.CatalogVersion == 10 {
				spacing = scaledClearanceSpacing(spacing, p.Width, 60)
			}
			if wetland.CatalogVersion >= 11 {
				spacing = 126400
				if bonusSegmentV2 && stationStep < 2 {
					spacing = 66880
				} else if bonusSegmentV2 && stationStep == 2 {
					spacing = 268000
				}
			}
			stationSpacing = &spacing
			raw = familySpec.GapCenters[stationStep]
			if wetland.CatalogVersion >= 11 {
				if wetland.CatalogVersion == 12 && index > 0 {
					raw = irregularBaseCenter(uint32(s.Descriptor.Seed), index, previousGap, s.Config)
				} else {
					raw = bonusSegmentV2OrdinaryCenter(uint32(s.Descriptor.Seed), index, previousGap, s.Config)
				}
			}
			if coinCourse && stationStep < 3 {
				raw = coinCourseGapCenter(uint32(s.Descriptor.Seed), wetlandBlock, stationStep)
			}
			if bonusSegment && stationStep < 3 {
				raw = bonusSegmentGapCenter(uint32(s.Descriptor.Seed), wetlandBlock, stationStep, s.Config)
			}
			if bonusSegmentV2 && stationStep < 3 {
				var err error
				raw, err = bonusSegmentV2GapCenter(uint32(s.Descriptor.Seed), wetlandBlock, stationStep, previousGap, s.Config)
				if err != nil {
					return Result{}, err
				}
			} else if wetland.CatalogVersion >= 7 && wetland.CatalogVersion < 11 && wetlandBlock >= int64(len(wetland.IntroFamilies)) {
				if wetland.CatalogVersion >= 9 && family != "steady" {
					raw = pressurePipeCenter(uint32(s.Descriptor.Seed), index, previousGap, s.Config)
				} else if wetland.CatalogVersion >= 8 {
					raw = variedPipeCenter(uint32(s.Descriptor.Seed), index, previousGap, family == "steady", s.Config)
				} else {
					raw = bonusSegmentV2OrdinaryCenter(uint32(s.Descriptor.Seed), index, previousGap, s.Config)
				}
			}
			if wetland.CatalogVersion == 2 {
				if varied, ok := variedWetlandGapCenter(uint32(s.Descriptor.Seed), index/4, stationStep, family, s.Config); ok {
					raw = varied
				}
			}
		}
		if challenge != nil && s.Config.Wetland == nil {
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
		if wetland := s.Config.Wetland; wetland != nil && wetland.CatalogVersion == 2 {
			if _, ok := variedWetlandGapCenter(uint32(s.Descriptor.Seed), index/4, stationStep, family, s.Config); ok {
				gap = raw
			}
		}
		previousGap = gap
		var challengeStepPointer *int64
		if challengeID != "" {
			value := challengeStep
			challengeStepPointer = &value
		}
		pipe := Pipe{ID: fmt.Sprintf("pipe-%d", index), Index: index, X: x, GapCenter: gap, ChallengeID: challengeID, ChallengeStep: challengeStepPointer}
		if family != "" {
			step := stationStep
			pipe.StationID = fmt.Sprintf("station-%d", index)
			pipe.StationStep = &step
			pipe.EncounterFamily = family
			pipe.StationSpacing = stationSpacing
			var typeID string
			for _, candidate := range s.Config.Wetland.Families {
				if candidate.ID == family {
					typeID = candidate.ObstacleTypes[stationStep]
					break
				}
			}
			if wetland := s.Config.Wetland; wetland.CatalogVersion == 2 && (typeID == "vine" || typeID == "rock") {
				polarityBlock := index / 4
				if polarityBlock == 1 {
					polarityBlock = 2
				} else if polarityBlock >= 3 && polarityBlock%2 == 1 {
					polarityBlock++
				}
				lane := pressureLaneCenter(uint32(s.Descriptor.Seed), polarityBlock, s.Config)
				if lane == s.Config.Pipes.GapMinCenter {
					typeID = "rock"
				} else if lane == s.Config.Pipes.GapMaxCenter {
					typeID = "vine"
				}
			}
			pipe.Obstacles = wetlandObstacles(typeID, gap, s.Config, uint32(s.Descriptor.Seed), index)
		}
		pipes = append(pipes, pipe)
		var e error
		index, e = inc(index, 1)
		if e != nil {
			return Result{}, e
		}
		if stationSpacing != nil {
			x += *stationSpacing
		} else {
			x += s.Config.Pipes.Spacing
		}
	}
	s.Pipes = pipes
	s.RNGState = rng
	s.NextPipeIndex = index
	s.LastGapCenter = previousGap
	if s.Config.Wetland != nil {
		nextX := x
		s.NextPipeX = &nextX
	}
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
