package simulation

import (
	"testing"
)

func foundationRun(t *testing.T, config Config) State {
	t.Helper()
	id, err := ConfigIDFor(config)
	if err != nil {
		t.Fatal(err)
	}
	s, err := CreateRun(Descriptor{"foundation-edge", 1, SimulationVersion, GeneratorVersion, id}, config)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestFoundationCollectiblePrototypeKeys(t *testing.T) {
	for _, typeID := range []string{"__proto__", "constructor", "toString"} {
		t.Run(typeID, func(t *testing.T) {
			c := DefaultConfiguration()
			c.Collectibles = []Definition{{typeID, 1, 1, 0, 0, 3, 7000, "appearance-v1"}}
			c.StarSchedule = nil
			s := foundationRun(t, c)
			s.Phase = Running
			s.Collectibles = []Collectible{{"edge-item", typeID, s.Duck.X, s.Duck.Y, 3, 7000, false}}
			r, err := Step(s, nil)
			if err != nil {
				t.Fatal(err)
			}
			if r.State.Totals[typeID] != 3 {
				t.Fatalf("total for %q = %d", typeID, r.State.Totals[typeID])
			}
			found := false
			for _, event := range r.Events {
				if event.Type == "CurrencyCollected" && event.TypeID == typeID && event.Amount != nil && *event.Amount == 3 {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing CurrencyCollected event: %#v", r.Events)
			}
			if len(s.Totals) != 0 || s.Collectibles[0].Collected {
				t.Fatal("Step mutated input state")
			}
		})
	}
}

func TestFoundationCanonicalJSONEscapesAndUTF16KeyOrder(t *testing.T) {
	got, err := CanonicalJSON(map[string]any{"text": "<>&\u2028\u2029"})
	if err != nil {
		t.Fatal(err)
	}
	if got != `{"text":"<>&  "}` {
		t.Errorf("canonical string = %s", got)
	}
	got, err = CanonicalJSON(map[string]any{"\U00010000": int64(1), "\uE000": int64(2)})
	if err != nil {
		t.Fatal(err)
	}
	if got != `{"𐀀":1,"":2}` {
		t.Fatalf("canonical key order = %s", got)
	}
}

func TestFoundationSpawnWeightAcceptsMaxSafeInteger(t *testing.T) {
	c := DefaultConfiguration()
	c.SpawnNoneWeight = 9007199254740991
	for i := range c.Collectibles {
		c.Collectibles[i].Weight = 0
	}
	if err := ValidateConfig(c); err != nil {
		t.Fatalf("valid max-safe spawn total rejected: %v", err)
	}
}

func TestFoundationNegativeMidpointsUseFloor(t *testing.T) {
	c := DefaultConfiguration()
	c.Challenges = nil
	c.Pipes.CeilingY, c.Pipes.FloorY = -1000000, -439001
	c.Pipes.GapMinCenter, c.Pipes.GapMaxCenter = -840000, -599999
	s := foundationRun(t, c)
	if s.Duck.Y != -719501 {
		t.Fatalf("duck Y = %d, want -719501", s.Duck.Y)
	}
	if got := s.Pipes[0].GapCenter; got != -685000 {
		t.Fatalf("first gap center = %d, want -685000", got)
	}
}
