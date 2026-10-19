package simulation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

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
		sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			a := appendJSONString(nil, k)
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
		if x, ok := v.(string); ok {
			return string(appendJSONString(nil, x)), nil
		}
		b, e := json.Marshal(x)
		return string(b), e
	}
}
func lessUTF16(a, b string) bool {
	left, right := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(left) && i < len(right); i++ {
		if left[i] != right[i] {
			return left[i] < right[i]
		}
	}
	return len(left) < len(right)
}

// appendJSONString matches JSON.stringify: Go's default encoder HTML-escapes
// characters such as <, >, and &, which changes TypeScript identities.
func appendJSONString(dst []byte, value string) []byte {
	dst = append(dst, '"')
	for _, r := range value {
		switch r {
		case '"', '\\':
			dst = append(dst, '\\', byte(r))
		case '\b':
			dst = append(dst, '\\', 'b')
		case '\f':
			dst = append(dst, '\\', 'f')
		case '\n':
			dst = append(dst, '\\', 'n')
		case '\r':
			dst = append(dst, '\\', 'r')
		case '\t':
			dst = append(dst, '\\', 't')
		default:
			if r < 0x20 {
				dst = append(dst, '\\', 'u', '0', '0', "0123456789abcdef"[byte(r)>>4], "0123456789abcdef"[byte(r)&0xf])
			} else {
				dst = append(dst, string(r)...)
			}
		}
	}
	return append(dst, '"')
}
func ConfigIDFor(c Config) (string, error) {
	if e := ValidateConfig(c); e != nil {
		return "", e
	}
	def, _ := CanonicalJSON(DefaultConfiguration())
	cur, _ := CanonicalJSON(c)
	if cur == def {
		return DefaultConfigID, nil
	}
	varied, _ := CanonicalJSON(VariedObstacleConfiguration())
	if cur == varied {
		return VariedObstacleDefaultConfigID, nil
	}
	prior, _ := CanonicalJSON(canonicalPriorDefaultConfig)
	if cur == prior {
		return PriorDefaultConfigID, nil
	}
	legacy, _ := CanonicalJSON(canonicalLegacyDefaultConfig)
	if cur == legacy {
		return LegacyDefaultConfigID, nil
	}
	wetland, _ := CanonicalJSON(WetlandConfiguration())
	if cur == wetland {
		return WetlandDefaultConfigID, nil
	}
	body, e := CanonicalJSON(struct {
		Configuration Config    `json:"configuration"`
		Patterns      []Pattern `json:"patterns"`
	}{c, canonicalCatalog})
	return "dd-v1-config:" + body, e
}
