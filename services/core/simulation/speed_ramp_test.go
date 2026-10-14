package simulation

import "testing"

func TestWorldSpeedAtBoundaries(t *testing.T) {
	config := DefaultConfiguration()
	for _, test := range []struct{ tick, want int64 }{{0, 2400}, {1, 2400}, {2, 2400}, {2701, 3600}, {5400, 4799}, {5401, 4800}, {9000, 4800}} {
		got, err := WorldSpeedAt(config, test.tick)
		if err != nil || got != test.want {
			t.Errorf("WorldSpeedAt(%d)=%d, %v; want %d", test.tick, got, err, test.want)
		}
	}
}

func TestSpeedRampChangesActualStepDisplacement(t *testing.T) {
	config := DefaultConfiguration()
	config.Pipes.MaxSpeed, config.Pipes.RampTicks = 4800, 5400
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := CreateRun(Descriptor{"speed-test", 3, "1.1.0", "1.0.0", id}, config)
	if err != nil {
		t.Fatal(err)
	}
	state.Phase, state.Tick = Running, 2700
	state.Duck.Y, state.Duck.VY = 280000, 0
	state.Pipes = []Pipe{{ID: "p", Index: 90, X: 800000, GapCenter: 280000}}
	state.Collectibles = []Collectible{{ID: "c", TypeID: "FEATHER", X: 800000, Y: 280000, Amount: 1, Radius: 7000}}
	result, err := Step(state, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.State.Pipes[0].X; got != 796400 {
		t.Fatalf("mid-ramp pipe x=%d, want 796400", got)
	}
	if got := result.State.Collectibles[0].X; got != 796400 {
		t.Fatalf("mid-ramp collectible x=%d, want 796400", got)
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
			c := DefaultConfiguration()
			mutate(&c)
			if ValidateConfig(c) == nil {
				t.Fatal("accepted invalid speed tuning")
			}
		})
	}
}
