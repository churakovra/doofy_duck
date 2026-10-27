package simulation

import (
	"encoding/json"
	"fmt"
)

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

type Phase string

const (
	Ready   Phase = "READY"
	Running Phase = "RUNNING"
	Paused  Phase = "PAUSED"
	Dead    Phase = "DEAD"
)

type Descriptor struct {
	RunID             string `json:"runId"`
	Seed              int64  `json:"seed"`
	SimulationVersion string `json:"simulationVersion"`
	GeneratorVersion  string `json:"generatorVersion"`
	ConfigID          string `json:"configId"`
}
type FlightConfig struct {
	Gravity        int64 `json:"gravity"`
	FlapVelocity   int64 `json:"flapVelocity"`
	MaxFallSpeed   int64 `json:"maxFallSpeed"`
	DuckX          int64 `json:"duckX"`
	DuckHalfWidth  int64 `json:"duckHalfWidth"`
	DuckHalfHeight int64 `json:"duckHalfHeight"`
}
type PipeConfig struct {
	Speed            int64 `json:"speed"`
	MaxSpeed         int64 `json:"maxSpeed"`
	RampTicks        int64 `json:"rampTicks"`
	SpeedEveryPipes  int64 `json:"speedEveryPipes"`
	SpeedStepPercent int64 `json:"speedStepPercent"`
	GapMinCenter     int64 `json:"gapMinCenter"`
	GapMaxCenter     int64 `json:"gapMaxCenter"`
	MaxGapDelta      int64 `json:"maxGapDelta"`
	Spacing          int64 `json:"spacing"`
	Width            int64 `json:"width"`
	GapHeight        int64 `json:"gapHeight"`
	SafeLeadIn       int64 `json:"safeLeadIn"`
	Horizon          int64 `json:"horizon"`
	FloorY           int64 `json:"floorY"`
	CeilingY         int64 `json:"ceilingY"`
}
type Limits struct {
	MaxActivePipes        int64 `json:"maxActivePipes"`
	MaxActiveCollectibles int64 `json:"maxActiveCollectibles"`
}
type Definition struct {
	TypeID          string `json:"typeId"`
	Version         int64  `json:"version"`
	Weight          int64  `json:"weight"`
	MinPipeIndex    int64  `json:"minPipeIndex"`
	MinSpacingPipes int64  `json:"minSpacingPipes"`
	Amount          int64  `json:"amount"`
	Radius          int64  `json:"radius"`
	Appearance      string `json:"appearance"`
}
type Config struct {
	Flight          FlightConfig   `json:"flight"`
	Pipes           PipeConfig     `json:"pipes"`
	Limits          Limits         `json:"limits"`
	Collectibles    []Definition   `json:"collectibles"`
	SpawnNoneWeight int64          `json:"spawnNoneWeight"`
	StarSchedule    *StarSchedule  `json:"starSchedule,omitempty"`
	Challenges      *ChallengeSet  `json:"challenges"`
	Wetland         *WetlandConfig `json:"wetland,omitempty"`
}
type WetlandConfig struct {
	StationSpacing   []int64                `json:"stationSpacing"`
	RecoverySpacing  int64                  `json:"recoverySpacing"`
	IntroFamilies    []string               `json:"introFamilies"`
	PressureFamilies []string               `json:"pressureFamilies"`
	CatalogVersion   int64                  `json:"catalogVersion"`
	StarFormations   *bool                  `json:"starFormations,omitempty"`
	Families         []WetlandFamily        `json:"families"`
	StarRoute        WetlandRewardPoint     `json:"starRoute"`
	Geometry         *WetlandGeometryConfig `json:"geometry,omitempty"`
	IntroLaneCenters []int64                `json:"introLaneCenters,omitempty"`
}
type WetlandGeometryConfig struct {
	HalfPipeMinPercent  int64 `json:"halfPipeMinPercent"`
	HalfPipeMaxPercent  int64 `json:"halfPipeMaxPercent"`
	FloatingBarMinWidth int64 `json:"floatingBarMinWidth"`
	FloatingBarMaxWidth int64 `json:"floatingBarMaxWidth"`
	FloatingBarHeight   int64 `json:"floatingBarHeight"`
}
type WetlandRewardPoint struct {
	XOffset int64 `json:"xOffset"`
	YOffset int64 `json:"yOffset"`
}
type WetlandFamily struct {
	ID             string               `json:"id"`
	GapCenters     []int64              `json:"gapCenters"`
	ObstacleTypes  []string             `json:"obstacleTypes"`
	StationSpacing []int64              `json:"stationSpacing"`
	RewardRoute    []WetlandRewardPoint `json:"rewardRoute"`
}
type ObstacleDefinition struct {
	TypeID  string `json:"typeId"`
	XOffset int64  `json:"xOffset"`
	Y       int64  `json:"y"`
	Width   int64  `json:"width"`
	Height  int64  `json:"height"`
}
type StarSchedule struct {
	MinIntervalPipes int64 `json:"minIntervalPipes"`
	MaxIntervalPipes int64 `json:"maxIntervalPipes"`
}
type ChallengeFamily struct {
	ID         string  `json:"id"`
	Band       string  `json:"band"`
	GapCenters []int64 `json:"gapCenters"`
}
type ChallengeSet struct {
	PipesPerFamily    int64             `json:"pipesPerFamily"`
	IntroFamilyID     string            `json:"introFamilyId"`
	CruiseFamilyIDs   []string          `json:"cruiseFamilyIds"`
	PressureFamilyIDs []string          `json:"pressureFamilyIds"`
	RecoveryFamilyID  string            `json:"recoveryFamilyId"`
	Families          []ChallengeFamily `json:"families"`
}
type Duck struct {
	X  int64 `json:"x"`
	Y  int64 `json:"y"`
	VY int64 `json:"vy"`
}
type Pipe struct {
	ID              string               `json:"id"`
	Index           int64                `json:"index"`
	X               int64                `json:"x"`
	GapCenter       int64                `json:"gapCenter"`
	Scored          bool                 `json:"scored"`
	ChallengeID     string               `json:"challengeId,omitempty"`
	ChallengeStep   *int64               `json:"challengeStep,omitempty"`
	StationID       string               `json:"stationId,omitempty"`
	StationStep     *int64               `json:"stationStep,omitempty"`
	EncounterFamily string               `json:"encounterFamily,omitempty"`
	StationSpacing  *int64               `json:"stationSpacing,omitempty"`
	Obstacles       []ObstacleDefinition `json:"obstacles,omitempty"`
}

func stationRightEdge(p Pipe, c Config) int64 {
	if c.Wetland != nil && len(p.Obstacles) > 0 {
		right := p.X + p.Obstacles[0].XOffset + p.Obstacles[0].Width/2
		for _, obstacle := range p.Obstacles[1:] {
			edge := p.X + obstacle.XOffset + obstacle.Width/2
			if edge > right {
				right = edge
			}
		}
		return right
	}
	return p.X + c.Pipes.Width/2
}
func stationRenderRightEdge(p Pipe, c Config) int64 {
	return stationRightEdge(p, c) + c.Pipes.Width
}

type Collectible struct {
	ID        string `json:"id"`
	TypeID    string `json:"typeId"`
	X         int64  `json:"x"`
	Y         int64  `json:"y"`
	Amount    int64  `json:"amount"`
	Radius    int64  `json:"radius"`
	Collected bool   `json:"collected"`
}
type Input struct {
	Sequence int64  `json:"sequence"`
	Action   string `json:"action"`
}
type State struct {
	Descriptor          Descriptor       `json:"descriptor"`
	Config              Config           `json:"config"`
	Phase               Phase            `json:"phase"`
	Tick                int64            `json:"tick"`
	Duck                Duck             `json:"duck"`
	Pipes               []Pipe           `json:"pipes"`
	Collectibles        []Collectible    `json:"collectibles"`
	Score               int64            `json:"score"`
	Totals              map[string]int64 `json:"totals"`
	RNGState            uint32           `json:"rngState"`
	NextPipeIndex       int64            `json:"nextPipeIndex"`
	NextPipeX           *int64           `json:"nextPipeX,omitempty"`
	LastGapCenter       int64            `json:"lastGapCenter"`
	NextInputSequence   int64            `json:"nextInputSequence"`
	LastCollectiblePipe int64            `json:"lastCollectiblePipe"`
	NextSpawnPipeIndex  int64            `json:"nextSpawnPipeIndex"`
	NextStarPipeIndex   int64            `json:"nextStarPipeIndex,omitempty"`
	StarScheduleOrdinal *int64           `json:"starScheduleOrdinal,omitempty"`
	InputHistory        []Input          `json:"inputHistory"`
	FinalizationCount   int64            `json:"finalizationCount"`
}
type Event struct {
	Type          string           `json:"type"`
	RunID         string           `json:"runId"`
	PipeID        string           `json:"pipeId,omitempty"`
	StationID     string           `json:"stationId,omitempty"`
	Score         *int64           `json:"score,omitempty"`
	Tick          int64            `json:"tick"`
	CollectibleID string           `json:"collectibleId,omitempty"`
	TypeID        string           `json:"typeId,omitempty"`
	Amount        *int64           `json:"amount,omitempty"`
	Totals        map[string]int64 `json:"totals,omitempty"`
}
type Result struct {
	State  State
	Events []Event
}

func (e Event) MarshalJSON() ([]byte, error) {
	type eventAlias Event
	if e.Type == "RunEnded" {
		return json.Marshal(struct {
			eventAlias
			Totals map[string]int64 `json:"totals"`
		}{eventAlias: eventAlias(e), Totals: cloneTotals(e.Totals)})
	}
	return json.Marshal(eventAlias(e))
}

type Pattern struct {
	ID   string  `json:"id"`
	Gaps []int64 `json:"gaps"`
}

var canonicalCatalog = []Pattern{{"center", []int64{280000, 280000, 280000, 280000}}, {"rise-fall", []int64{260000, 280000, 300000, 280000}}, {"fall-rise", []int64{300000, 280000, 260000, 280000}}}
var canonicalLegacyDefaultConfig = Config{FlightConfig{320, -5600, 8500, 100000, 12000, 10000}, PipeConfig{Speed: 3000, MaxSpeed: 4800, RampTicks: 2700, SpeedEveryPipes: 10, SpeedStepPercent: 10, GapMinCenter: 160000, GapMaxCenter: 400000, MaxGapDelta: 85000, Spacing: 300000, Width: 52000, GapHeight: 156000, SafeLeadIn: 420000, Horizon: 960000, FloorY: 561000, CeilingY: 0}, Limits{8, 2}, []Definition{{"FEATHER", 1, 34, 1, 1, 1, 7000, "feather-v1"}, {"GAME_STAR", 1, 8, 4, 3, 1, 7000, "game-star-v1"}}, 58, nil, defaultChallengeSet(), nil}
var canonicalPriorDefaultConfig = Config{FlightConfig{320, -5600, 8500, 100000, 12000, 10000}, PipeConfig{Speed: 3000, MaxSpeed: 4800, RampTicks: 2700, SpeedEveryPipes: 10, SpeedStepPercent: 10, GapMinCenter: 160000, GapMaxCenter: 400000, MaxGapDelta: 85000, Spacing: 300000, Width: 52000, GapHeight: 156000, SafeLeadIn: 420000, Horizon: 960000, FloorY: 561000, CeilingY: 0}, Limits{8, 3}, []Definition{{"FEATHER", 1, 34, 1, 1, 1, 7000, "feather-v1"}, {"GAME_STAR", 1, 0, 4, 3, 1, 7000, "game-star-v1"}}, 66, &StarSchedule{8, 16}, defaultChallengeSet(), nil}

func defaultChallengeSet() *ChallengeSet {
	return &ChallengeSet{4, "intro-steady", []string{"cruise-steady", "cruise-rise", "cruise-dip", "cruise-offset"}, []string{"pressure-rise", "pressure-dip", "pressure-offset"}, "recovery-steady", []ChallengeFamily{
		{"intro-steady", "intro", []int64{280000, 280000, 280000, 280000}},
		{"cruise-steady", "cruise", []int64{280000, 280000, 280000, 280000}},
		{"cruise-rise", "cruise", []int64{265000, 275000, 290000, 305000}},
		{"cruise-dip", "cruise", []int64{295000, 285000, 270000, 255000}},
		{"cruise-offset", "cruise", []int64{300000, 300000, 270000, 270000}},
		{"pressure-rise", "pressure", []int64{280000, 230000, 190000, 270000}},
		{"pressure-dip", "pressure", []int64{280000, 320000, 350000, 280000}},
		{"pressure-offset", "pressure", []int64{280000, 330000, 300000, 220000}},
		{"recovery-steady", "recovery", []int64{280000, 280000, 280000, 280000}},
	}}
}

// PatternCatalog returns a copy of the legacy catalog, retained for compatibility.
func PatternCatalog() []Pattern {
	out := make([]Pattern, len(canonicalCatalog))
	for i, pattern := range canonicalCatalog {
		out[i] = Pattern{ID: pattern.ID, Gaps: append([]int64(nil), pattern.Gaps...)}
	}
	return out
}

// DefaultConfiguration returns an independent copy of the default rules.
func PriorDefaultConfiguration() Config  { return cloneConfig(canonicalPriorDefaultConfig) }
func DefaultConfiguration() Config       { return VariedBaseConfiguration() }
func LegacyDefaultConfiguration() Config { return cloneConfig(canonicalLegacyDefaultConfig) }
func WetlandConfiguration() Config {
	c := cloneConfig(canonicalPriorDefaultConfig)
	c.Challenges = nil
	c.Limits.MaxActiveCollectibles = 10
	coinRoute := func(points ...int64) []WetlandRewardPoint {
		out := make([]WetlandRewardPoint, 0, len(points)/2)
		for i := 0; i < len(points); i += 2 {
			out = append(out, WetlandRewardPoint{XOffset: points[i], YOffset: points[i+1]})
		}
		return out
	}
	c.Wetland = &WetlandConfig{CatalogVersion: 1, StationSpacing: []int64{240000, 300000, 360000}, RecoverySpacing: 360000, IntroFamilies: []string{"steady", "quick-pairs"}, PressureFamilies: []string{"dive-climb", "climb-dive", "slalom"}, StarRoute: WetlandRewardPoint{XOffset: 100000, YOffset: 70000}, Families: []WetlandFamily{
		{ID: "steady", GapCenters: []int64{280000, 280000, 280000, 250000}, ObstacleTypes: []string{"pipes", "vine", "rock", "debris"}, StationSpacing: []int64{300000, 300000, 300000, 300000}, RewardRoute: coinRoute(-16000, 0, 16000, 18000, -16000, 18000, 16000, 68000)},
		{ID: "quick-pairs", GapCenters: []int64{280000, 280000, 280000, 280000}, ObstacleTypes: []string{"pipes", "pipes", "vine", "vine"}, StationSpacing: []int64{240000, 240000, 360000, 360000}, RewardRoute: coinRoute(16000, 0, -16000, -18000, 16000, 18000, -16000, 0)},
		{ID: "dive-climb", GapCenters: []int64{300000, 330000, 260000, 230000}, ObstacleTypes: []string{"rock", "debris", "vine", "pipes"}, StationSpacing: []int64{300000, 360000, 300000, 240000}, RewardRoute: coinRoute(-16000, -18000, 16000, -68000, -16000, 18000, 16000, 0)},
		{ID: "climb-dive", GapCenters: []int64{260000, 230000, 300000, 330000}, ObstacleTypes: []string{"vine", "debris", "pipes", "rock"}, StationSpacing: []int64{300000, 360000, 300000, 240000}, RewardRoute: coinRoute(16000, 18000, -16000, 68000, 16000, -18000, -16000, 0)},
		{ID: "slalom", GapCenters: []int64{280000, 330000, 260000, 320000}, ObstacleTypes: []string{"vine", "pipes", "rock", "debris"}, StationSpacing: []int64{300000, 240000, 360000, 300000}, RewardRoute: coinRoute(-16000, 0, 16000, -18000, -16000, 18000, 16000, -68000)},
	}}
	return c
}

func VariedObstacleConfiguration() Config {
	c := WetlandConfiguration()
	c.Pipes.GapMinCenter, c.Pipes.GapMaxCenter, c.Pipes.MaxGapDelta = 78000, 483000, 120000
	c.Wetland.CatalogVersion = 2
	c.Wetland.Geometry = &WetlandGeometryConfig{HalfPipeMinPercent: 70, HalfPipeMaxPercent: 90, FloatingBarMinWidth: 90000, FloatingBarMaxWidth: 216000, FloatingBarHeight: 42000}
	c.Wetland.IntroLaneCenters = []int64{280000, 340000, 400000, 483000}
	for i := range c.Wetland.Families {
		family := &c.Wetland.Families[i]
		family.GapCenters = []int64{480000, 480000, 480000, 480000}
		if family.ID == "steady" {
			family.ObstacleTypes = []string{"pipes", "pipes", "pipes", "pipes"}
		}
	}
	return c
}

func PairedRoutesConfiguration() Config {
	c := WetlandConfiguration()
	c.Wetland.CatalogVersion = 3
	c.Wetland.StarRoute.YOffset = 35000
	for i := range c.Wetland.Families {
		c.Wetland.Families[i].ObstacleTypes = []string{"pipes", "pipes", "pipes", "pipes"}
	}
	return c
}

func CurrencyFormationsConfiguration() Config {
	c := PairedRoutesConfiguration()
	c.Wetland.CatalogVersion = 4
	c.Limits.MaxActiveCollectibles = 29
	return c
}

func CoinCourseConfiguration() Config {
	c := CurrencyFormationsConfiguration()
	c.Wetland.CatalogVersion = 5
	return c
}

func BonusSegmentsConfiguration() Config {
	c := CoinCourseConfiguration()
	c.StarSchedule = &StarSchedule{MinIntervalPipes: 12, MaxIntervalPipes: 16}
	c.Wetland.CatalogVersion = 6
	disabled := false
	c.Wetland.StarFormations = &disabled
	return c
}

func BonusSegmentsV2Configuration() Config {
	c := BonusSegmentsConfiguration()
	c.StarSchedule = &StarSchedule{MinIntervalPipes: 14, MaxIntervalPipes: 16}
	c.Wetland.CatalogVersion = 7
	return c
}

func VariedPipesConfiguration() Config {
	c := BonusSegmentsV2Configuration()
	c.Wetland.CatalogVersion = 8
	return c
}

func PressurePipesConfiguration() Config {
	c := VariedPipesConfiguration()
	c.Wetland.CatalogVersion = 9
	return c
}

func DensePipesConfiguration() Config {
	c := PressurePipesConfiguration()
	c.Wetland.CatalogVersion = 10
	c.Limits.MaxActivePipes = 18
	c.StarSchedule = &StarSchedule{MinIntervalPipes: 16, MaxIntervalPipes: 16}
	return c
}

func BaseBonusConfiguration() Config {
	c := DensePipesConfiguration()
	c.Wetland.CatalogVersion = 11
	return c
}

func VariedBaseConfiguration() Config {
	c := BaseBonusConfiguration()
	c.Wetland.CatalogVersion = 12
	return c
}

const MaxCounter int64 = 9007199254740990
const maxSafeInteger int64 = 9007199254740991
const PairedRoutesSimulationVersion = "2.2.0"
const PairedRoutesGeneratorVersion = "2.2.0"
const PairedRoutesConfigID = "dd-v2-paired-routes-v1"
const VariedPipesSimulationVersion = "2.7.0"
const VariedPipesGeneratorVersion = "2.7.0"
const VariedPipesConfigID = "dd-v2-varied-pipes-v1"
const PressurePipesSimulationVersion = "2.8.0"
const PressurePipesGeneratorVersion = "2.8.0"
const PressurePipesConfigID = "dd-v2-pressure-pipes-v1"
const DensePipesSimulationVersion = "2.9.0"
const DensePipesGeneratorVersion = "2.9.0"
const DensePipesConfigID = "dd-v2-dense-pipes-v1"
const BaseBonusSimulationVersion = "3.0.0"
const BaseBonusGeneratorVersion = "3.0.0"
const BaseBonusConfigID = "dd-v3-base-bonus-v1"
const SimulationVersion = "3.1.0"
const GeneratorVersion = "3.1.0"
const DefaultConfigID = "dd-v3-varied-base-v1"
const CurrencyFormationsSimulationVersion = "2.3.0"
const CurrencyFormationsGeneratorVersion = "2.3.0"
const CurrencyFormationsConfigID = "dd-v2-currency-formations-v1"
const CoinCourseSimulationVersion = "2.4.0"
const CoinCourseGeneratorVersion = "2.4.0"
const CoinCourseConfigID = "dd-v2-coin-course-v1"
const BonusSegmentsSimulationVersion = "2.5.0"
const BonusSegmentsGeneratorVersion = "2.5.0"
const BonusSegmentsConfigID = "dd-v2-bonus-segments-v1"
const BonusSegmentsV2SimulationVersion = "2.6.0"
const BonusSegmentsV2GeneratorVersion = "2.6.0"
const BonusSegmentsV2ConfigID = "dd-v2-bonus-segments-v2"
const VariedObstacleSimulationVersion = "2.1.0"
const VariedObstacleGeneratorVersion = "2.1.0"
const VariedObstacleDefaultConfigID = "dd-v2-varied-obstacles-v1"
const PriorSimulationVersion = "1.4.0"
const PriorGeneratorVersion = "1.3.0"
const PriorDefaultConfigID = "dd-v1-star-interval-v1"
const LegacySimulationVersion = "1.3.0"
const LegacyGeneratorVersion = "1.2.0"
const LegacyDefaultConfigID = "dd-v1-stepped-v1"
const WetlandSimulationVersion = "2.0.0"
const WetlandGeneratorVersion = "2.0.0"
const WetlandDefaultConfigID = "dd-v2-wetland-v1"

func Step(input State, frames []Input) (Result, error) {
	input = cloneState(input)
	if input.Phase == Dead || input.Phase == Paused {
		return Result{input, []Event{}}, nil
	}
	for _, v := range []int64{input.Tick, input.Score, input.NextInputSequence, input.NextPipeIndex, input.NextSpawnPipeIndex} {
		if _, e := inc(v, 1); e != nil {
			return Result{}, e
		}
	}
	if input.Config.StarSchedule != nil {
		if _, e := inc(input.NextStarPipeIndex, 1); e != nil {
			return Result{}, e
		}
		if input.StarScheduleOrdinal != nil {
			if _, e := inc(*input.StarScheduleOrdinal, 1); e != nil {
				return Result{}, e
			}
		}
	}
	if len(frames) > 64 {
		return Result{}, fmt.Errorf("input batch limit")
	}
	expected := input.NextInputSequence
	for _, f := range frames {
		if f.Sequence != expected || f.Action != "FLAP" {
			return Result{}, fmt.Errorf("input sequence")
		}
		var e error
		expected, e = inc(expected, 1)
		if e != nil {
			return Result{}, e
		}
	}
	events := []Event{}
	phase, y, vy := input.Phase, input.Duck.Y, input.Duck.VY
	if phase == Ready {
		if len(frames) == 0 {
			input.NextInputSequence = expected
			return Result{input, events}, nil
		}
		phase = Running
		events = append(events, Event{Type: "RunStarted", RunID: input.Descriptor.RunID, Tick: input.Tick + 1})
	}
	if len(frames) > 0 {
		vy = input.Config.Flight.FlapVelocity
	}
	vy = min64(input.Config.Flight.MaxFallSpeed, vy+input.Config.Flight.Gravity)
	y += vy
	pc, f := input.Config.Pipes, input.Config.Flight
	speed, speedErr := WorldSpeedAt(input.Config, input.Tick+1, input.Score)
	if speedErr != nil {
		return Result{}, speedErr
	}
	pipes := append([]Pipe{}, input.Pipes...)
	for i := range pipes {
		pipes[i].X -= speed
	}
	duck := Duck{f.DuckX, y, vy}
	dead := y-f.DuckHalfHeight <= pc.CeilingY || y+f.DuckHalfHeight >= pc.FloorY
	for _, p := range pipes {
		l, r := p.X-pc.Width/2, p.X+pc.Width/2
		dl, dr := duck.X-f.DuckHalfWidth, duck.X+f.DuckHalfWidth
		if input.Config.Wetland != nil && len(p.Obstacles) > 0 {
			for _, obstacle := range p.Obstacles {
				ol, or := p.X+obstacle.XOffset-obstacle.Width/2, p.X+obstacle.XOffset+obstacle.Width/2
				if dr >= ol && dl <= or && y+f.DuckHalfHeight >= obstacle.Y && y-f.DuckHalfHeight <= obstacle.Y+obstacle.Height {
					dead = true
				}
			}
		} else if dr >= l && dl <= r && (y-f.DuckHalfHeight <= p.GapCenter-pc.GapHeight/2 || y+f.DuckHalfHeight >= p.GapCenter+pc.GapHeight/2) {
			dead = true
		}
	}
	score := input.Score
	if dead {
		phase = Dead
		sc := score
		events = append(events, Event{Type: "RunEnded", RunID: input.Descriptor.RunID, Score: &sc, Totals: cloneTotals(input.Totals), Tick: input.Tick + 1})
	} else {
		for i := range pipes {
			p := &pipes[i]
			if !p.Scored && stationRightEdge(*p, input.Config) < duck.X-f.DuckHalfWidth {
				var e error
				score, e = inc(score, 1)
				if e != nil {
					return Result{}, e
				}
				p.Scored = true
				sc := score
				if input.Config.Wetland != nil {
					events = append(events, Event{Type: "ObstaclePassed", RunID: input.Descriptor.RunID, StationID: p.StationID, Score: &sc, Tick: input.Tick + 1})
				} else {
					events = append(events, Event{Type: "PipePassed", RunID: input.Descriptor.RunID, PipeID: p.ID, Score: &sc, Tick: input.Tick + 1})
				}
			}
		}
	}
	keptP := []Pipe{}
	for _, p := range pipes {
		if input.Config.Wetland != nil {
			if input.Config.Wetland.CatalogVersion >= 2 {
				if stationRenderRightEdge(p, input.Config) >= 0 {
					keptP = append(keptP, p)
				}
			} else if stationRightEdge(p, input.Config) >= duck.X-f.DuckHalfWidth {
				keptP = append(keptP, p)
			}
		} else if p.X+pc.Width >= -pc.Width {
			keptP = append(keptP, p)
		}
	}
	s := input
	s.Phase = phase
	s.Tick++
	s.Duck = duck
	s.Pipes = keptP
	if input.Config.Wetland != nil && input.NextPipeX != nil {
		nextX := *input.NextPipeX - speed
		s.NextPipeX = &nextX
	}
	s.Score = score
	s.NextInputSequence = expected
	s.InputHistory = []Input{}
	if dead {
		count, err := inc(s.FinalizationCount, 1)
		if err != nil {
			return Result{}, err
		}
		s.FinalizationCount = count
	}
	if phase != Running {
		return Result{s, events}, nil
	}
	gen, e := generateNextOwned(s)
	if e != nil {
		return Result{}, e
	}
	s = gen.State
	spawned := map[string]bool{}
	nextSpawn := s.NextSpawnPipeIndex
	nextStar := s.NextStarPipeIndex
	starOrdinal := s.StarScheduleOrdinal
	rng := s.RNGState
	for _, p := range s.Pipes {
		if p.Index < nextSpawn {
			continue
		}
		nextSpawn, e = inc(p.Index, 1)
		if e != nil {
			return Result{}, e
		}
		defs := []Definition{}
		weight := s.Config.SpawnNoneWeight
		for _, d := range s.Config.Collectibles {
			if p.Index >= d.MinPipeIndex && p.Index-s.LastCollectiblePipe >= d.MinSpacingPipes {
				defs = append(defs, d)
				weight += d.Weight
			}
		}
		sample := Mix32(rng)
		rng += 0x9e3779b9
		roll := int64(0)
		if weight > 0 {
			roll = int64(sample) % weight
		}
		cum := s.Config.SpawnNoneWeight
		var chosen *Definition
		if weight > 0 && roll >= s.Config.SpawnNoneWeight {
			for i := range defs {
				cum += defs[i].Weight
				if defs[i].Weight > 0 && roll < cum {
					chosen = &defs[i]
					break
				}
			}
		}
		scheduledStar := s.Config.StarSchedule != nil && p.Index == nextStar
		block := p.Index / 4
		coinCourse := s.Config.Wetland != nil && s.Config.Wetland.CatalogVersion == 5 && isCoinCourseBlock(uint32(s.Descriptor.Seed), block)
		bonusSegment := s.Config.Wetland != nil && s.Config.Wetland.CatalogVersion == 6 && isBonusSegmentBlock(uint32(s.Descriptor.Seed), block)
		bonusSegmentV2 := s.Config.Wetland != nil && s.Config.Wetland.CatalogVersion >= 7 && isScheduledBonusBlock(s.Config, uint32(s.Descriptor.Seed), block)
		recovery := p.EncounterFamily == "steady" && block >= 2 && block%2 == 1
		smallTrail := p.EncounterFamily == "steady" && (block == 0 || recovery)
		wetlandTrail := s.Config.Wetland != nil && s.Config.Wetland.CatalogVersion <= 5 && (coinCourse && p.StationStep != nil && *p.StationStep == 2 || !coinCourse && (!smallTrail || p.StationStep != nil && (*p.StationStep == 1 || *p.StationStep == 3)))
		bonusSegmentReward := (bonusSegment || bonusSegmentV2) && p.StationStep != nil && *p.StationStep == 2
		if wetlandTrail || bonusSegmentReward {
			var definition *Definition
			for i := range s.Config.Collectibles {
				if s.Config.Collectibles[i].TypeID == "FEATHER" {
					definition = &s.Config.Collectibles[i]
					break
				}
			}
			if definition == nil {
				return Result{}, fmt.Errorf("wetland FEATHER definition missing")
			}
			points := currencyFormationPoints(s.Config, uint32(s.Descriptor.Seed), p, definition.Radius, false, p.Index)
			if int64(len(s.Collectibles)+len(points)) > s.Config.Limits.MaxActiveCollectibles {
				return Result{}, fmt.Errorf("wetland reward capacity invariant violated")
			}
			for member, point := range points {
				id := fmt.Sprintf("feather-trail-%d-%d", block, *p.StationStep)
				if bonusSegmentReward {
					id = fmt.Sprintf("bonus-segment-%d-%d", block, member)
				} else if s.Config.Wetland.CatalogVersion >= 4 {
					id += fmt.Sprintf("-%d", member)
				}
				spawned[id] = true
				s.Collectibles = append(s.Collectibles, Collectible{id, "FEATHER", point[0], point[1], 1, definition.Radius, false})
			}
		}
		if scheduledStar {
			activeStars := 0
			for _, collectible := range s.Collectibles {
				if collectible.TypeID == "GAME_STAR" {
					activeStars++
				}
			}
			id := fmt.Sprintf("star-%d", p.Index)
			schedule := s.Config.StarSchedule
			var starDefinition *Definition
			for i := range s.Config.Collectibles {
				if s.Config.Collectibles[i].TypeID == "GAME_STAR" {
					starDefinition = &s.Config.Collectibles[i]
					break
				}
			}
			if starDefinition == nil {
				return Result{}, fmt.Errorf("scheduled Star definition missing")
			}
			var points [][2]int64
			if s.Config.Wetland != nil {
				ordinal := int64(0)
				if starOrdinal != nil {
					ordinal = *starOrdinal
				}
				points = currencyFormationPoints(s.Config, uint32(s.Descriptor.Seed), p, starDefinition.Radius, true, ordinal)
			} else {
				points = [][2]int64{{p.X, bonusY(s.Config, uint32(s.Descriptor.Seed), p, starDefinition.Radius)}}
			}
			if activeStars > 0 || int64(len(s.Collectibles)+len(points)) > s.Config.Limits.MaxActiveCollectibles {
				return Result{}, fmt.Errorf("scheduled Star capacity invariant violated")
			}
			for member, point := range points {
				memberID := id
				if s.Config.Wetland != nil && s.Config.Wetland.CatalogVersion >= 4 {
					memberID += fmt.Sprintf("-%d", member)
				}
				spawned[memberID] = true
				s.Collectibles = append(s.Collectibles, Collectible{memberID, "GAME_STAR", point[0], point[1], 1, starDefinition.Radius, false})
			}
			ordinal := int64(1)
			if starOrdinal != nil {
				ordinal, e = inc(*starOrdinal, 1)
				if e != nil {
					return Result{}, e
				}
			}
			gap := starInterval(uint32(s.Descriptor.Seed), ordinal, schedule.MinIntervalPipes, schedule.MaxIntervalPipes)
			nextStar, e = inc(nextStar, gap)
			if e != nil {
				return Result{}, e
			}
			starOrdinal = &ordinal
		}
		regularCount := int64(len(s.Collectibles))
		if s.Config.StarSchedule != nil {
			regularCount = 0
			for _, collectible := range s.Collectibles {
				if collectible.TypeID != "GAME_STAR" {
					regularCount++
				}
			}
		}
		reservedSlots := int64(0)
		if s.Config.StarSchedule != nil {
			reservedSlots = 1
		}
		ordinaryPickupAllowed := s.Config.Wetland == nil ||
			s.Config.Wetland.CatalogVersion == 6 && (!bonusSegment || p.StationStep != nil && *p.StationStep == 3) ||
			s.Config.Wetland.CatalogVersion >= 7 && (!bonusSegmentV2 || p.StationStep != nil && *p.StationStep == 3)
		if ordinaryPickupAllowed && chosen != nil && !scheduledStar && regularCount < s.Config.Limits.MaxActiveCollectibles-reservedSlots {
			id := fmt.Sprintf("collectible-%d", p.Index)
			spawned[id] = true
			s.Collectibles = append(s.Collectibles, Collectible{id, chosen.TypeID, p.X, bonusY(s.Config, uint32(s.Descriptor.Seed), p, chosen.Radius), chosen.Amount, chosen.Radius, false})
			s.LastCollectiblePipe = p.Index
		}
	}
	s.RNGState = rng
	s.NextSpawnPipeIndex = nextSpawn
	if s.Config.StarSchedule != nil {
		s.NextStarPipeIndex = nextStar
		s.StarScheduleOrdinal = starOrdinal
	}
	keptC := []Collectible{}
	for _, c := range s.Collectibles {
		if !spawned[c.ID] {
			c.X -= speed
		}
		if abs(c.X-duck.X) <= c.Radius+f.DuckHalfWidth && abs(c.Y-y) <= c.Radius+f.DuckHalfHeight {
			amt := c.Amount
			events = append(events, Event{Type: "CurrencyCollected", RunID: input.Descriptor.RunID, CollectibleID: c.ID, TypeID: c.TypeID, Amount: &amt, Tick: input.Tick + 1})
			if s.Totals == nil {
				s.Totals = map[string]int64{}
			}
			s.Totals[c.TypeID], e = inc(s.Totals[c.TypeID], c.Amount)
			if e != nil {
				return Result{}, e
			}
		} else if c.X+c.Radius >= 0 {
			keptC = append(keptC, c)
		}
	}
	s.Collectibles = keptC
	return Result{s, events}, nil
}
func Pause(s State) (State, error) {
	s = cloneState(s)
	if s.Phase != Running {
		return State{}, fmt.Errorf("not running")
	}
	s.Phase = Paused
	return s, nil
}
func Resume(s State) (State, error) {
	s = cloneState(s)
	if s.Phase != Paused {
		return State{}, fmt.Errorf("not paused")
	}
	s.Phase = Running
	s.InputHistory = []Input{}
	return s, nil
}
func Restart(s State, d Descriptor, c Config) (State, error) {
	if d.RunID == s.Descriptor.RunID {
		return State{}, fmt.Errorf("same run")
	}
	return CreateRun(d, c)
}
