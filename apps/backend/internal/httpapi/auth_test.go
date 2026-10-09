package httpapi

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/golang-jwt/jwt/v5"
)

const appID = "test-app"

// authServer serves GET /v1/profiles/{profileId}/probe behind both checks, with Alice owning one profile.
// Privy is replaced by a local P-256 key pair.
func authServer(t *testing.T) (srv *httptest.Server, privyKey *ecdsa.PrivateKey, aliceProfile string) {
	t.Helper()
	ctx := context.Background()
	privyKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&privyKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := auth.NewVerifier(appID, string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})))
	if err != nil {
		t.Fatal(err)
	}

	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	err = pool.QueryRow(ctx, `
		WITH a AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     b AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:bob') RETURNING id),
		     bp AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM b)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM a RETURNING id::text`).Scan(&aliceProfile)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	probe := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	mux.Handle("GET /v1/profiles/{profileId}/probe", requireUser(verifier, requireProfileOwner(auth.NewService(pool), probe)))
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, privyKey, aliceProfile
}

func claims(subject string) jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{"sid": "session-1", "sub": subject, "iss": "privy.io", "aud": appID,
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix()}
}

func signES256(t *testing.T, key *ecdsa.PrivateKey, c jwt.MapClaims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(jwt.SigningMethodES256, c).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func get(t *testing.T, srv *httptest.Server, profile, token string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/v1/profiles/"+profile+"/probe", nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func TestOnlyValidPrivyTokensPass(t *testing.T) {
	srv, privyKey, profile := authServer(t)
	otherKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	with := func(key string, value any) jwt.MapClaims {
		c := claims("did:privy:alice")
		c[key] = value
		return c
	}
	without := func(key string) jwt.MapClaims {
		c := claims("did:privy:alice")
		delete(c, key)
		return c
	}
	none, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims("did:privy:alice")).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	// HS256 keyed with the public key bytes: the classic algorithm-confusion attack.
	pub, err := x509.MarshalPKIXPublicKey(&privyKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	hs256, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims("did:privy:alice")).SignedString(pub)
	if err != nil {
		t.Fatal(err)
	}
	valid := signES256(t, privyKey, claims("did:privy:alice"))
	// Bob's claims under Alice's signature.
	parts, bobParts := strings.Split(valid, "."), strings.Split(signES256(t, privyKey, claims("did:privy:bob")), ".")
	tampered := parts[0] + "." + bobParts[1] + "." + parts[2]

	tests := []struct {
		name  string
		token string
		want  int
	}{
		{"valid", valid, http.StatusOK},
		{"no token", "", http.StatusUnauthorized},
		{"expired", signES256(t, privyKey, with("exp", time.Now().Add(-time.Minute).Unix())), http.StatusUnauthorized},
		{"no expiry", signES256(t, privyKey, without("exp")), http.StatusUnauthorized},
		{"other issuer", signES256(t, privyKey, with("iss", "evil.io")), http.StatusUnauthorized},
		{"other audience", signES256(t, privyKey, with("aud", "other-app")), http.StatusUnauthorized},
		{"no subject", signES256(t, privyKey, without("sub")), http.StatusUnauthorized},
		{"alg none", none, http.StatusUnauthorized},
		{"alg HS256", hs256, http.StatusUnauthorized},
		{"signed by another key", signES256(t, otherKey, claims("did:privy:alice")), http.StatusUnauthorized},
		{"tampered payload", tampered, http.StatusUnauthorized},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := get(t, srv, profile, tt.token); got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func TestOnlyTheOwnerActsForAProfile(t *testing.T) {
	srv, privyKey, aliceProfile := authServer(t)
	alice := signES256(t, privyKey, claims("did:privy:alice"))
	bob := signES256(t, privyKey, claims("did:privy:bob"))
	stranger := signES256(t, privyKey, claims("did:privy:stranger"))

	tests := []struct {
		name, token, profile string
		want                 int
	}{
		{"owner", alice, aliceProfile, http.StatusOK},
		{"another user's profile", bob, aliceProfile, http.StatusForbidden},
		{"user not in the database", stranger, aliceProfile, http.StatusForbidden},
		{"unknown profile", alice, "00000000-0000-0000-0000-000000000000", http.StatusForbidden},
		{"malformed profile ID", alice, "not-a-uuid", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := get(t, srv, tt.profile, tt.token); got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}

// Without requireUser in front, the owner check denies instead of querying for an empty user.
func TestOwnerCheckNeedsASignedInUser(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/profiles/x/probe", nil)
	requireProfileOwner(nil, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler ran without a user")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", rec.Code)
	}
}

// Verification uses only the configured key: with every outgoing HTTP call failing, a valid token still passes.
func TestVerificationMakesNoNetworkCall(t *testing.T) {
	srv, privyKey, profile := authServer(t)
	token := signES256(t, privyKey, claims("did:privy:alice"))
	original := http.DefaultTransport
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		t.Errorf("unexpected network call to %s", r.URL.Host)
		return nil, errors.New("network disabled")
	})
	t.Cleanup(func() { http.DefaultTransport = original })

	if got := get(t, srv, profile, token); got != http.StatusOK {
		t.Fatalf("got %d, want 200", got)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
