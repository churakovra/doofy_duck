package core

import (
	"crypto/ed25519"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type JWTVerifier struct {
	Keys map[string]ed25519.PublicKey
	Now  func() time.Time
}

type Claims struct {
	AccountID string
	JTI       string
	ExpiresAt time.Time
}

func (v JWTVerifier) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(parts[0]) > 4096 || len(parts[1]) > 8192 || len(parts[2]) > 256 {
		return Claims{}, fmt.Errorf("invalid bearer token")
	}
	decode := func(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }
	headerBytes, err := decode(parts[0])
	if err != nil {
		return Claims{}, fmt.Errorf("invalid jwt header")
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
	}
	if err = json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "EdDSA" || header.KeyID == "" {
		return Claims{}, fmt.Errorf("invalid jwt header")
	}
	key := v.Keys[header.KeyID]
	if len(key) != ed25519.PublicKeySize {
		return Claims{}, fmt.Errorf("unknown signing key")
	}
	signature, err := decode(parts[2])
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(key, []byte(parts[0]+"."+parts[1]), signature) {
		return Claims{}, fmt.Errorf("invalid jwt signature")
	}
	payload, err := decode(parts[1])
	if err != nil {
		return Claims{}, fmt.Errorf("invalid jwt claims")
	}
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(strings.NewReader(string(payload)))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&raw); err != nil {
		return Claims{}, fmt.Errorf("invalid jwt claims")
	}
	if err = dec.Decode(new(any)); err != io.EOF {
		return Claims{}, fmt.Errorf("invalid jwt claims")
	}
	if len(raw) != 7 {
		return Claims{}, fmt.Errorf("unexpected jwt claims")
	}
	var iss, sub, jti string
	var iat, exp int64
	var aud json.RawMessage
	for name, dst := range map[string]any{"iss": &iss, "sub": &sub, "jti": &jti, "iat": &iat, "exp": &exp, "aud": &aud} {
		value, ok := raw[name]
		if !ok {
			return Claims{}, fmt.Errorf("missing jwt claim %s", name)
		}
		if err := json.Unmarshal(value, dst); err != nil {
			return Claims{}, fmt.Errorf("invalid jwt claim %s", name)
		}
	}
	scopeRaw, ok := raw["scope"]
	if !ok {
		return Claims{}, fmt.Errorf("missing jwt claim scope")
	}
	var scopes []string
	if json.Unmarshal(scopeRaw, &scopes) != nil || len(scopes) != 1 || !hasScopeList(scopes, "run:write") {
		return Claims{}, fmt.Errorf("invalid jwt scope")
	}
	var audience string
	if err = json.Unmarshal(aud, &audience); err != nil {
		return Claims{}, fmt.Errorf("invalid audience")
	}
	if iss != "doofy-platform" || audience != "doofy-core" || !uuidPattern.MatchString(sub) || !uuidPattern.MatchString(jti) {
		return Claims{}, fmt.Errorf("invalid jwt identity or scope")
	}
	now := time.Now()
	if v.Now != nil {
		now = v.Now()
	}
	unix := now.Unix()
	if exp <= unix || iat > unix+30 || exp <= iat || exp-iat > 600 {
		return Claims{}, fmt.Errorf("expired or invalid jwt lifetime")
	}
	return Claims{AccountID: strings.ToLower(sub), JTI: jti, ExpiresAt: time.Unix(exp, 0)}, nil
}

func hasScopeList(scope []string, required string) bool {
	for _, part := range scope {
		if subtle.ConstantTimeCompare([]byte(part), []byte(required)) == 1 {
			return true
		}
	}
	return false
}
