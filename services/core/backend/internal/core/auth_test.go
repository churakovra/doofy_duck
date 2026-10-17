package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestJWTVerifierRequiresExactEdDSAClaims(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	v := JWTVerifier{Keys: map[string]ed25519.PublicKey{"active": pub}, Now: func() time.Time { return time.Unix(1_800_000_000, 0) }}
	claims := map[string]any{"iss": "doofy-platform", "aud": "doofy-core", "sub": "00000000-0000-4000-8000-000000000001", "iat": 1_800_000_000, "exp": 1_800_000_300, "jti": "00000000-0000-4000-8000-000000000009", "scope": []string{"run:write"}}
	good := signedJWT(t, priv, "active", "EdDSA", claims)
	if _, err := v.Verify(good); err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	for _, token := range []string{
		signedJWT(t, priv, "active", "none", claims),
		signedJWT(t, priv, "retired", "EdDSA", claims),
		signedJWT(t, priv, "active", "EdDSA", map[string]any{"iss": "doofy-platform", "aud": "doofy-core", "sub": "00000000-0000-4000-8000-000000000001", "iat": 1_800_000_000, "exp": 1_800_000_300, "jti": "00000000-0000-4000-8000-000000000009", "scope": []string{"other"}}),
	} {
		if _, err := v.Verify(token); err == nil {
			t.Fatalf("invalid token accepted: %s", token)
		}
	}
}

func signedJWT(t *testing.T, key ed25519.PrivateKey, kid, alg string, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": alg, "typ": "JWT", "kid": kid})
	payload, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	if alg == "none" {
		return input + "."
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(input)))
}

func TestJWTVerifierRejectsLifetimeAndMalformedSubject(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	v := JWTVerifier{Keys: map[string]ed25519.PublicKey{"k": pub}, Now: func() time.Time { return time.Unix(1_800_000_000, 0) }}
	claims := map[string]any{"iss": "doofy-platform", "aud": "doofy-core", "sub": "not-a-uuid", "iat": 1_800_000_000, "exp": 1_800_000_700, "jti": "00000000-0000-4000-8000-000000000009", "scope": []string{"run:write"}}
	if _, err := v.Verify(signedJWT(t, priv, "k", "EdDSA", claims)); err == nil {
		t.Fatal("bad subject and >10m lifetime accepted")
	}
	if strings.Contains(signedJWT(t, priv, "k", "EdDSA", claims), " ") {
		t.Fatal("unexpected token encoding")
	}
}

func TestPlatformDevAuthTokenInteroperability(t *testing.T) {
	endpoint := os.Getenv("CORE_TEST_PLATFORM_URL")
	encodedKeys := os.Getenv("ACCESS_TOKEN_PUBLIC_KEYS_JSON")
	if endpoint == "" || encodedKeys == "" {
		t.Skip("CORE_TEST_PLATFORM_URL and ACCESS_TOKEN_PUBLIC_KEYS_JSON are required for platform interoperability")
	}
	var rawKeys map[string]string
	if err := json.Unmarshal([]byte(encodedKeys), &rawKeys); err != nil {
		t.Fatal(err)
	}
	keys := make(map[string]ed25519.PublicKey, len(rawKeys))
	for kid, value := range rawKeys {
		decoded, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			t.Fatalf("invalid platform public key %q", kid)
		}
		keys[kid] = ed25519.PublicKey(decoded)
	}
	body := strings.NewReader(`{"telegram_user_id":100000001}`)
	resp, err := http.Post(strings.TrimRight(endpoint, "/")+"/api/v1/auth/dev", "application/json", body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("platform dev auth status %d", resp.StatusCode)
	}
	var issued struct {
		AccessToken string `json:"access_token"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&issued); err != nil || issued.AccessToken == "" {
		t.Fatalf("platform did not return an access token: %v", err)
	}
	if _, err = (JWTVerifier{Keys: keys}).Verify(issued.AccessToken); err != nil {
		t.Fatalf("Core rejected platform-issued token: %v", err)
	}
}

func TestPythonPlatformIssuerInterop(t *testing.T) {
	python := os.Getenv("CORE_TEST_PYTHON")
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate test source")
	}
	platformDir, err := filepath.Abs(filepath.Join(filepath.Dir(source), "../../../../../services/platform"))
	if err != nil {
		t.Fatal("cannot locate Platform issuer package")
	}
	if python == "" {
		python = filepath.Join(platformDir, ".venv/bin/python")
	}
	if _, err := os.Stat(python); err != nil {
		if os.Getenv("CORE_REQUIRE_PYTHON_INTEROP") == "true" {
			t.Fatalf("Python issuer interoperability is required but CORE_TEST_PYTHON is unavailable")
		}
		t.Skip("Python platform environment unavailable; set CORE_TEST_PYTHON to enable producer interoperability")
	}
	program := `import base64, json, uuid
from datetime import UTC, datetime
from app.tokens import Ed25519TokenIssuer
issuer = Ed25519TokenIssuer.generate("core-test")
token = issuer.issue("00000000-0000-4000-8000-000000000001", now=datetime.fromtimestamp(1800000000, UTC))
print(json.dumps({"token": token, "public_key": base64.urlsafe_b64encode(issuer.public_key_bytes()).rstrip(b"=").decode()}))`
	cmd := exec.Command(python, "-c", program)
	cmd.Dir = platformDir
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Platform token producer failed: %v", err)
	}
	var produced struct {
		Token     string `json:"token"`
		PublicKey string `json:"public_key"`
	}
	if err := json.Unmarshal(output, &produced); err != nil || produced.Token == "" || produced.PublicKey == "" {
		t.Fatalf("Platform token producer returned invalid test output: %v", err)
	}
	publicKey, err := base64.RawURLEncoding.DecodeString(produced.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		t.Fatal("Platform producer returned an invalid Ed25519 public key")
	}
	verifier := JWTVerifier{
		Keys: map[string]ed25519.PublicKey{"core-test": ed25519.PublicKey(publicKey)},
		Now:  func() time.Time { return time.Unix(1_800_000_000, 0) },
	}
	if _, err := verifier.Verify(produced.Token); err != nil {
		t.Fatalf("Core rejected token from the Platform producer: %v", err)
	}
}
