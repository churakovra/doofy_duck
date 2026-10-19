package simulation

import "testing"

func TestScoreAddsSpeedAtPipeBoundariesAndCapsSafely(t *testing.T) {
	c := PriorDefaultConfiguration()
	for _, tc := range []struct{ score, want int64 }{{0, 3000}, {9, 3000}, {10, 3300}, {20, 3600}, {40, 4200}, {1000, 4800}} {
		got, err := WorldSpeedAt(c, 1, tc.score)
		if err != nil || got != tc.want {
			t.Errorf("score %d: speed=%d err=%v want=%d", tc.score, got, err, tc.want)
		}
	}
	if _, err := WorldSpeedAt(c, 1, -1); err == nil {
		t.Fatal("negative score accepted")
	}
}

func TestWorldSpeedAtBoundaries(t *testing.T) {
	config := PriorDefaultConfiguration()
	for _, test := range []struct{ tick, want int64 }{{0, 3000}, {1, 3000}, {2, 3000}, {1351, 3900}, {2700, 4799}, {2701, 4800}, {5401, 4800}} {
		got, err := WorldSpeedAt(config, test.tick)
		if err != nil || got != test.want {
			t.Errorf("WorldSpeedAt(%d)=%d, %v; want %d", test.tick, got, err, test.want)
		}
	}
}

func TestSpeedRampChangesActualStepDisplacement(t *testing.T) {
	config := PriorDefaultConfiguration()
	config.Pipes.MaxSpeed, config.Pipes.RampTicks = 4800, 5400
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{"speed-test", 3, PriorSimulationVersion, PriorGeneratorVersion, id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase, state.Tick = Running, 1350
	state.Duck.Y, state.Duck.VY = 280000, 0
	state.Pipes = []Pipe{{ID: "p", Index: 90, X: 800000, GapCenter: 280000}}
	state.Collectibles = []Collectible{{ID: "c", TypeID: "FEATHER", X: 800000, Y: 280000, Amount: 1, Radius: 7000}}
	result, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.State.Pipes[0].X; got != 796550 {
		t.Fatalf("mid-ramp pipe x=%d, want 796550", got)
	}
	if got := result.State.Collectibles[0].X; got != 796550 {
		t.Fatalf("mid-ramp collectible x=%d, want 796550", got)
	}
}

func TestSpeedRampRejectsUnsafeConfiguration(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"missing speed fields": func(c *Config) { c.Pipes.MaxSpeed = 0; c.Pipes.RampTicks = 0 },
		"width below cap":      func(c *Config) { c.Pipes.MaxSpeed = 52001; c.Pipes.RampTicks = 5400 },
		"max below base":       func(c *Config) { c.Pipes.MaxSpeed = 2399; c.Pipes.RampTicks = 5400 },
		"overflow-prone ramp":  func(c *Config) { c.Pipes.MaxSpeed = 4800; c.Pipes.RampTicks = 20000000 },
		"unsafe ramp":          func(c *Config) { c.Pipes.MaxSpeed = 4800; c.Pipes.RampTicks = 1 << 53 },
	} {
		t.Run(name, func(t *testing.T) {
			c := PriorDefaultConfiguration()
			mutate(&c)
			if ValidateConfig(c) == nil {
				t.Fatal("accepted invalid speed tuning")
			}
		})
	}
}
