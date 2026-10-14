package simulation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

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
	Speed      int64 `json:"speed"`
	Spacing    int64 `json:"spacing"`
	Width      int64 `json:"width"`
	GapHeight  int64 `json:"gapHeight"`
	SafeLeadIn int64 `json:"safeLeadIn"`
	Horizon    int64 `json:"horizon"`
	FloorY     int64 `json:"floorY"`
	CeilingY   int64 `json:"ceilingY"`
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
	Flight          FlightConfig `json:"flight"`
	Pipes           PipeConfig   `json:"pipes"`
	Limits          Limits       `json:"limits"`
	Collectibles    []Definition `json:"collectibles"`
	SpawnNoneWeight int64        `json:"spawnNoneWeight"`
}
type Duck struct {
	X  int64 `json:"x"`
	Y  int64 `json:"y"`
	VY int64 `json:"vy"`
}
type Pipe struct {
	ID        string `json:"id"`
	Index     int64  `json:"index"`
	X         int64  `json:"x"`
	GapCenter int64  `json:"gapCenter"`
	Scored    bool   `json:"scored"`
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
	NextInputSequence   int64            `json:"nextInputSequence"`
	LastCollectiblePipe int64            `json:"lastCollectiblePipe"`
	NextSpawnPipeIndex  int64            `json:"nextSpawnPipeIndex"`
	InputHistory        []Input          `json:"inputHistory"`
	FinalizationCount   int64            `json:"finalizationCount"`
}
type Event struct {
	Type          string           `json:"type"`
	RunID         string           `json:"runId"`
	PipeID        string           `json:"pipeId,omitempty"`
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
var canonicalDefaultConfig = Config{FlightConfig{80, -4200, 6000, 160000, 12000, 10000}, PipeConfig{2400, 220000, 52000, 176000, 420000, 960000, 580000, 0}, Limits{8, 2}, []Definition{{"FEATHER", 1, 18, 2, 3, 1, 7000, "feather-v1"}, {"GAME_STAR", 1, 4, 5, 5, 1, 7000, "game-star-v1"}}, 78}

// PatternCatalog returns an independent copy of the authored pattern rules.
func PatternCatalog() []Pattern {
	out := make([]Pattern, len(canonicalCatalog))
	for i, pattern := range canonicalCatalog {
		out[i] = Pattern{ID: pattern.ID, Gaps: append([]int64(nil), pattern.Gaps...)}
	}
	return out
}

// DefaultConfiguration returns an independent copy of the default rules.
func DefaultConfiguration() Config { return cloneConfig(canonicalDefaultConfig) }

const MaxCounter int64 = 9007199254740990
const maxSafeInteger int64 = 9007199254740991

func Mix32(x uint32) uint32 {
	x ^= x >> 16
	x *= 0x85ebca6b
	x ^= x >> 13
	x *= 0xc2b2ae35
	x ^= x >> 16
	return x
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
	numericValues := []int64{f.Gravity, f.FlapVelocity, f.MaxFallSpeed, f.DuckX, f.DuckHalfWidth, f.DuckHalfHeight, p.Speed, p.Spacing, p.Width, p.GapHeight, p.SafeLeadIn, p.Horizon, p.FloorY, p.CeilingY, c.Limits.MaxActivePipes, c.Limits.MaxActiveCollectibles, c.SpawnNoneWeight}
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
	vals := []int64{f.Gravity, f.FlapVelocity, f.MaxFallSpeed, f.DuckX, f.DuckHalfWidth, f.DuckHalfHeight, p.Speed, p.Spacing, p.Width, p.GapHeight, p.SafeLeadIn, p.Horizon, p.FloorY, p.CeilingY}
	for _, v := range vals {
		if v < -10000000 || v > 10000000 {
			return fmt.Errorf("config bound")
		}
	}
	if p.Speed <= 0 || p.Spacing <= 0 || p.Width < p.Speed || p.Width <= 0 || p.GapHeight <= 2*f.DuckHalfHeight || p.Horizon < p.SafeLeadIn || p.FloorY <= p.CeilingY+p.GapHeight {
		return fmt.Errorf("invalid pipe geometry")
	}
	for _, pat := range canonicalCatalog {
		for _, g := range pat.Gaps {
			if g-p.GapHeight/2 < p.CeilingY || g+p.GapHeight/2 > p.FloorY {
				return fmt.Errorf("invalid pipe geometry")
			}
		}
	}
	if c.Limits.MaxActivePipes < 2 || c.Limits.MaxActiveCollectibles < 0 || c.SpawnNoneWeight < 0 {
		return fmt.Errorf("config limits")
	}
	seen := map[string]bool{}
	total := c.SpawnNoneWeight
	for _, d := range c.Collectibles {
		if d.TypeID == "" || seen[d.TypeID] || d.Version < 1 || d.Weight < 0 || d.MinPipeIndex < 0 || d.MinSpacingPipes < 0 || d.Amount <= 0 || d.Radius <= 0 || d.Radius >= p.GapHeight/2 || d.Appearance == "" {
			return fmt.Errorf("invalid collectible definition")
		}
		seen[d.TypeID] = true
		if total > maxSafeInteger-d.Weight {
			return fmt.Errorf("weights")
		}
		total += d.Weight
	}
	if total <= 0 || total > MaxCounter {
		return fmt.Errorf("spawn table")
	}
	return nil
}
func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}
func CanonicalJSON(v any) (string, error) {
	b, e := json.Marshal(v)
	if e != nil {
		return "", e
	}
	var x any
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if e = d.Decode(&x); e != nil {
		return "", e
	}
	return canonical(x)
}
func canonical(v any) (string, error) {
	switch x := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			a, _ := json.Marshal(k)
			b, e := canonical(x[k])
			if e != nil {
				return "", e
			}
			parts = append(parts, string(a)+":"+b)
		}
		return "{" + strings.Join(parts, ",") + "}", nil
	case []any:
		parts := make([]string, len(x))
		for i, a := range x {
			b, e := canonical(a)
			if e != nil {
				return "", e
			}
			parts[i] = b
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	case json.Number:
		n, err := strconv.ParseInt(string(x), 10, 64)
		if err != nil || n < -maxSafeInteger || n > maxSafeInteger {
			return "", fmt.Errorf("canonical JSON number outside safe integer domain: %s", x)
		}
		return strconv.FormatInt(n, 10), nil
	default:
		b, e := json.Marshal(x)
		return string(b), e
	}
}
func ConfigIDFor(c Config) (string, error) {
	if e := ValidateConfig(c); e != nil {
		return "", e
	}
	def, _ := CanonicalJSON(canonicalDefaultConfig)
	cur, _ := CanonicalJSON(c)
	if cur == def {
		return "dd-v1-default", nil
	}
	body, e := CanonicalJSON(struct {
		Configuration Config    `json:"configuration"`
		Patterns      []Pattern `json:"patterns"`
	}{c, canonicalCatalog})
	return "dd-v1-config:" + body, e
}
func validateDescriptor(d Descriptor) error {
	if d.Seed < 0 || d.Seed > 4294967295 {
		return fmt.Errorf("invalid seed")
	}
	if strings.TrimSpace(d.RunID) == "" || d.SimulationVersion != "1.0.0" || d.GeneratorVersion != "1.0.0" || d.ConfigID == "" {
		return fmt.Errorf("invalid descriptor")
	}
	return nil
}
func CreateRun(d Descriptor, c Config) (State, error) {
	if e := validateDescriptor(d); e != nil {
		return State{}, e
	}
	if e := ValidateConfig(c); e != nil {
		return State{}, e
	}
	id, e := ConfigIDFor(c)
	if e != nil || d.ConfigID != id {
		return State{}, fmt.Errorf("configId mismatch")
	}
	s := State{Descriptor: d, Config: cloneConfig(c), Phase: Ready, Duck: Duck{X: c.Flight.DuckX, Y: (c.Pipes.FloorY + c.Pipes.CeilingY) / 2}, Pipes: []Pipe{}, Collectibles: []Collectible{}, Totals: map[string]int64{}, RNGState: uint32(d.Seed), LastCollectiblePipe: -1000000, InputHistory: []Input{}}
	r, e := GenerateNext(s)
	return r.State, e
}
func GenerateNext(s State) (Result, error) {
	s = cloneState(s)
	pipes := append([]Pipe{}, s.Pipes...)
	rng, index := s.RNGState, s.NextPipeIndex
	x := s.Config.Pipes.SafeLeadIn
	if len(pipes) > 0 {
		x = pipes[len(pipes)-1].X + s.Config.Pipes.Spacing
	}
	for int64(len(pipes)) < s.Config.Limits.MaxActivePipes && x <= s.Config.Pipes.Horizon {
		rng += 0x9e3779b9
		block := uint32(index/4+1) * uint32(0x9e3779b9)
		choice := Mix32(uint32(s.Descriptor.Seed) ^ block)
		pat := canonicalCatalog[int(choice)%len(canonicalCatalog)]
		pipes = append(pipes, Pipe{fmt.Sprintf("pipe-%d", index), index, x, pat.Gaps[index%int64(len(pat.Gaps))], false})
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
	return Result{State: s, Events: []Event{}}, nil
}
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
	pipes := append([]Pipe{}, input.Pipes...)
	for i := range pipes {
		pipes[i].X -= pc.Speed
	}
	duck := Duck{f.DuckX, y, vy}
	dead := y-f.DuckHalfHeight <= pc.CeilingY || y+f.DuckHalfHeight >= pc.FloorY
	for _, p := range pipes {
		l, r := p.X-pc.Width/2, p.X+pc.Width/2
		dl, dr := duck.X-f.DuckHalfWidth, duck.X+f.DuckHalfWidth
		if dr >= l && dl <= r && (y-f.DuckHalfHeight <= p.GapCenter-pc.GapHeight/2 || y+f.DuckHalfHeight >= p.GapCenter+pc.GapHeight/2) {
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
			if !p.Scored && p.X+pc.Width/2 < duck.X-f.DuckHalfWidth {
				var e error
				score, e = inc(score, 1)
				if e != nil {
					return Result{}, e
				}
				p.Scored = true
				sc := score
				events = append(events, Event{Type: "PipePassed", RunID: input.Descriptor.RunID, PipeID: p.ID, Score: &sc, Tick: input.Tick + 1})
			}
		}
	}
	keptP := []Pipe{}
	for _, p := range pipes {
		if p.X+pc.Width >= -pc.Width {
			keptP = append(keptP, p)
		}
	}
	s := input
	s.Phase = phase
	s.Tick++
	s.Duck = duck
	s.Pipes = keptP
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
	gen, e := GenerateNext(s)
	if e != nil {
		return Result{}, e
	}
	s = gen.State
	spawned := map[string]bool{}
	nextSpawn := s.NextSpawnPipeIndex
	rng := s.RNGState
	for _, p := range s.Pipes {
		if p.Index < nextSpawn {
			continue
		}
		nextSpawn, e = inc(p.Index, 1)
		if e != nil {
			return Result{}, e
		}
		if p.Index < 2 {
			continue
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
		if weight == 0 {
			continue
		}
		roll := int64(sample) % weight
		cum := s.Config.SpawnNoneWeight
		var chosen *Definition
		if roll >= s.Config.SpawnNoneWeight {
			for i := range defs {
				cum += defs[i].Weight
				if defs[i].Weight > 0 && roll < cum {
					chosen = &defs[i]
					break
				}
			}
		}
		if chosen != nil && int64(len(s.Collectibles)) < s.Config.Limits.MaxActiveCollectibles {
			id := fmt.Sprintf("collectible-%d", p.Index)
			spawned[id] = true
			s.Collectibles = append(s.Collectibles, Collectible{id, chosen.TypeID, p.X, p.GapCenter, chosen.Amount, chosen.Radius, false})
			s.LastCollectiblePipe = p.Index
		}
	}
	s.RNGState = rng
	s.NextSpawnPipeIndex = nextSpawn
	keptC := []Collectible{}
	for _, c := range s.Collectibles {
		if !spawned[c.ID] {
			c.X -= pc.Speed
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
func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
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

type fixture struct {
	FixtureRevision string `json:"fixtureRevision"`
	MixerVectors    []struct {
		Input  uint32 `json:"input"`
		Output uint32 `json:"output"`
	} `json:"mixerVectors"`
	Cases []struct {
		Name       string            `json:"name"`
		Synthetic  bool              `json:"syntheticInitialState"`
		Initial    json.RawMessage   `json:"initialState"`
		Operations []json.RawMessage `json:"operations"`
	} `json:"cases"`
	Invalid []json.RawMessage `json:"invalidCases"`
}

func VerifyFoundationFixtures(path string) error {
	data, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	var f fixture
	if e = json.Unmarshal(data, &f); e != nil {
		return e
	}
	if f.FixtureRevision != "foundation-2" || len(f.Cases) != 9 || len(f.Invalid) != 5 || len(f.MixerVectors) != 4 {
		return fmt.Errorf("unexpected fixture revision/case count")
	}
	operationCount, advanceTicks := 0, 0
	for _, fixtureCase := range f.Cases {
		operationCount += len(fixtureCase.Operations)
		for _, rawOperation := range fixtureCase.Operations {
			var operation struct {
				Kind  string `json:"kind"`
				Ticks int    `json:"ticks"`
			}
			if err := json.Unmarshal(rawOperation, &operation); err != nil {
				return err
			}
			if operation.Kind == "advance" {
				advanceTicks += operation.Ticks
			}
		}
	}
	if operationCount != 24 || advanceTicks != 24200 {
		return fmt.Errorf("unexpected fixture operation/tick count: %d/%d", operationCount, advanceTicks)
	}
	for _, c := range f.Cases {
		if len(c.Initial) == 0 || string(c.Initial) == "null" {
			return fmt.Errorf("%s missing initialState", c.Name)
		}
		var s State
		if e = json.Unmarshal(c.Initial, &s); e != nil {
			return fmt.Errorf("%s initialState: %w", c.Name, e)
		}
		if c.Synthetic {
			if er := equalRaw(s, c.Initial); er != nil {
				return fmt.Errorf("%s synthetic initial: %w", c.Name, er)
			}
		} else {
			created, er := CreateRun(s.Descriptor, s.Config)
			if er != nil {
				return fmt.Errorf("%s createRun: %w", c.Name, er)
			}
			if er = equalRaw(created, c.Initial); er != nil {
				return fmt.Errorf("%s initial: %w", c.Name, er)
			}
		}
		for i, raw := range c.Operations {
			var op map[string]json.RawMessage
			if e = json.Unmarshal(raw, &op); e != nil {
				return e
			}
			if len(op["expectedState"]) == 0 || string(op["expectedState"]) == "null" {
				return fmt.Errorf("%s op%d missing expectedState", c.Name, i)
			}
			if len(op["expectedEvents"]) == 0 || string(op["expectedEvents"]) == "null" {
				return fmt.Errorf("%s op%d missing expectedEvents", c.Name, i)
			}
			var kind string
			if e = json.Unmarshal(op["kind"], &kind); e != nil {
				return fmt.Errorf("%s op%d missing/invalid kind", c.Name, i)
			}
			var got State
			var events []Event = []Event{}
			switch kind {
			case "step":
				var frames []Input
				if len(op["frames"]) > 0 {
					_ = json.Unmarshal(op["frames"], &frames)
				}
				r, er := Step(s, frames)
				if er != nil {
					return fmt.Errorf("%s op%d: %w", c.Name, i, er)
				}
				got, events = r.State, r.Events
			case "advance":
				var ticks int
				_ = json.Unmarshal(op["ticks"], &ticks)
				var flapTicks []int
				_ = json.Unmarshal(op["flapTicks"], &flapTicks)
				flaps := map[int]bool{}
				for _, t := range flapTicks {
					flaps[t] = true
				}
				events = []Event{}
				got = s
				for t := 1; t <= ticks; t++ {
					fr := []Input{}
					if flaps[t] {
						fr = append(fr, Input{got.NextInputSequence, "FLAP"})
					}
					r, er := Step(got, fr)
					if er != nil {
						return fmt.Errorf("%s op%d: %w", c.Name, i, er)
					}
					got = r.State
					events = append(events, r.Events...)
				}
			case "pause":
				got, e = Pause(s)
			case "resume":
				got, e = Resume(s)
			case "restart":
				var d Descriptor
				_ = json.Unmarshal(op["descriptor"], &d)
				got, e = Restart(s, d, s.Config)
				events = []Event{}
			default:
				return fmt.Errorf("unknown op %q", kind)
			}
			if e != nil {
				return fmt.Errorf("%s op%d: %w", c.Name, i, e)
			}
			if e = equalRaw(got, op["expectedState"]); e != nil {
				return fmt.Errorf("%s op%d state: %w", c.Name, i, e)
			}
			if e = equalRaw(events, op["expectedEvents"]); e != nil {
				return fmt.Errorf("%s op%d events: %w", c.Name, i, e)
			}
			s = got
		}
	}
	for i, raw := range f.Invalid {
		var x struct {
			Name       string     `json:"name"`
			Kind       string     `json:"kind"`
			Descriptor Descriptor `json:"descriptor"`
			Config     Config     `json:"config"`
			Initial    State      `json:"initialState"`
			Frames     []Input    `json:"frames"`
		}
		if e = json.Unmarshal(raw, &x); e != nil {
			return e
		}
		var er error
		if x.Kind == "create" {
			_, er = CreateRun(x.Descriptor, x.Config)
		} else {
			_, er = Step(x.Initial, x.Frames)
		}
		if er == nil {
			return fmt.Errorf("invalid case %d (%s) did not reject", i, x.Name)
		}
	}
	return nil
}
func equalRaw(actual any, expected json.RawMessage) error {
	got, err := json.Marshal(actual)
	if err != nil {
		return err
	}
	decode := func(data []byte) (any, error) {
		var value any
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		return value, nil
	}
	gotValue, err := decode(got)
	if err != nil {
		return err
	}
	wantValue, err := decode(expected)
	if err != nil {
		return err
	}
	gotCanonical, err := canonical(gotValue)
	if err != nil {
		return err
	}
	wantCanonical, err := canonical(wantValue)
	if err != nil {
		return err
	}
	if gotCanonical == wantCanonical {
		return nil
	}
	return fmt.Errorf("raw JSON mismatch: got %s want %s", truncate(gotCanonical), truncate(wantCanonical))
}

func equal(a, b any) error {
	x, e := json.Marshal(a)
	if e != nil {
		return e
	}
	y, e := json.Marshal(b)
	if e != nil {
		return e
	}
	if bytes.Equal(x, y) {
		return nil
	}
	i := 0
	for i < len(x) && i < len(y) && x[i] == y[i] {
		i++
	}
	lo := i - 100
	if lo < 0 {
		lo = 0
	}
	hi := i + 180
	if hi > len(x) {
		hi = len(x)
	}
	whi := i + 180
	if whi > len(y) {
		whi = len(y)
	}
	return fmt.Errorf("JSON mismatch at byte %d: got %s want %s", i, x[lo:hi], y[lo:whi])
}
func truncate(s string) string {
	if len(s) > 500 {
		return s[:500] + "…"
	}
	return s
}
