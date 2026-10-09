package auth

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/auth/authtest"
	"github.com/golang-jwt/jwt/v5"
)

func claims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{"sub": "did:privy:alice", "iss": "privy.io", "aud": "app",
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix()}
}

func newVerifier(t *testing.T, p *authtest.Privy) *Verifier {
	t.Helper()
	v, err := NewVerifier(context.Background(), "app", p.JWKSURL, http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestVerifyUsesTheKeyNamedByKid(t *testing.T) {
	ctx := context.Background()
	p := authtest.NewPrivy(t)
	p.AddKey(t, "key-2") // Privy publishes two keys
	v := newVerifier(t, p)

	for _, kid := range []string{"key-1", "key-2"} {
		if _, err := v.Verify(ctx, authtest.Sign(t, p.Key(kid), kid, claims())); err != nil {
			t.Fatalf("token signed by %s: %v", kid, err)
		}
	}
	if _, err := v.Verify(ctx, authtest.Sign(t, p.Key("key-1"), "", claims())); err != nil {
		t.Fatalf("token without kid, signed by a published key: %v", err)
	}
	if _, err := v.Verify(ctx, authtest.Sign(t, p.Key("key-2"), "key-1", claims())); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("kid key-1 but signed by key-2: got %v", err)
	}
	if n := p.Fetches.Load(); n != 1 {
		t.Fatalf("%d JWKS fetches, want only the one at startup", n)
	}
}

// An unknown kid fetches the keys again at most once per minute; a rotated-in key then works.
func TestUnknownKidRefetchesAtMostOncePerMinute(t *testing.T) {
	ctx := context.Background()
	p := authtest.NewPrivy(t)
	v := newVerifier(t, p)
	now := time.Now()
	v.now = func() time.Time { return now }

	rotated := p.AddKey(t, "key-new")
	token := authtest.Sign(t, rotated, "key-new", claims())
	if _, err := v.Verify(ctx, token); !errors.Is(err, ErrUnauthorized) || p.Fetches.Load() != 1 {
		t.Fatalf("within a minute of the last fetch: got %v after %d fetches, want 401 and no fetch", err, p.Fetches.Load())
	}
	now = now.Add(RefetchInterval)
	if _, err := v.Verify(ctx, token); err != nil || p.Fetches.Load() != 2 {
		t.Fatalf("after a minute: got %v after %d fetches, want the rotated key to work after 1 fetch", err, p.Fetches.Load())
	}
	for range 5 {
		if _, err := v.Verify(ctx, authtest.Sign(t, rotated, "key-unknown", claims())); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("unknown kid: got %v", err)
		}
	}
	if n := p.Fetches.Load(); n != 2 {
		t.Fatalf("%d fetches after 5 unknown kids in the same minute, want 2", n)
	}
}

func TestNewVerifierNeedsKeys(t *testing.T) {
	ctx := context.Background()
	p := authtest.NewPrivy(t)
	if _, err := NewVerifier(ctx, "", p.JWKSURL, http.DefaultClient); err == nil {
		t.Fatal("empty app ID accepted")
	}
	res, err := http.Get(p.JWKSURL)
	if err != nil {
		t.Fatal(err)
	}
	validJWKS, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"valid keys with status 500": "500" + string(validJWKS),
		"no keys":                    `{"keys": []}`,
		"only an RSA key":            `{"keys": [{"kty": "RSA", "kid": "r", "n": "AQAB", "e": "AQAB"}]}`,
		"point not on P256":          `{"keys": [{"kty": "EC", "crv": "P-256", "kid": "k", "x": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "y": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}`,
		"not JSON":                   `<html>`,
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if rest, ok := strings.CutPrefix(body, "500"); ok {
				w.WriteHeader(http.StatusInternalServerError)
				body = rest
			}
			_, _ = w.Write([]byte(body))
		}))
		if _, err := NewVerifier(ctx, "app", srv.URL, http.DefaultClient); err == nil {
			t.Errorf("%s: verifier created", name)
		}
		srv.Close()
	}
}

// A caller that hangs up must not abort the shared refetch: the rotated key still loads.
func TestRefetchSurvivesACancelledRequest(t *testing.T) {
	p := authtest.NewPrivy(t)
	v := newVerifier(t, p)
	now := time.Now().Add(RefetchInterval)
	v.now = func() time.Time { return now }
	rotated := p.AddKey(t, "key-new")
	token := authtest.Sign(t, rotated, "key-new", claims())

	gone, cancel := context.WithCancel(context.Background())
	cancel()
	_, _ = v.Verify(gone, authtest.Sign(t, rotated, "key-new", claims()))
	if _, err := v.Verify(context.Background(), token); err != nil {
		t.Fatalf("rotated key after a cancelled refetch: %v", err)
	}
}

// A key Privy stops publishing is no longer trusted once the key list is older than MaxKeyAge.
func TestWithdrawnKeyStopsVerifying(t *testing.T) {
	ctx := context.Background()
	p := authtest.NewPrivy(t)
	p.AddKey(t, "key-2")
	v := newVerifier(t, p)
	now := time.Now()
	v.now = func() time.Time { return now }
	token := authtest.Sign(t, p.Key("key-2"), "key-2", claims())
	if _, err := v.Verify(ctx, token); err != nil {
		t.Fatal(err)
	}
	p.RemoveKey("key-2")
	now = now.Add(MaxKeyAge + time.Second)
	if _, err := v.Verify(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("withdrawn key after MaxKeyAge: got %v, want 401", err)
	}
	if _, err := v.Verify(ctx, authtest.Sign(t, p.Key("key-1"), "key-1", claims())); err != nil {
		t.Fatalf("a still-published key: %v", err)
	}
	if n := p.Fetches.Load(); n != 2 {
		t.Fatalf("%d fetches, want 2 (startup and one refresh)", n)
	}
}
