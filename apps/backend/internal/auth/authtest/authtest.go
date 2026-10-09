// Package authtest stands in for Privy in tests: a JWKS endpoint and tokens signed with its keys.
package authtest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

// Privy serves its published keys at JWKSURL and counts the fetches.
type Privy struct {
	JWKSURL string
	Fetches atomic.Int64

	mu   sync.Mutex
	keys map[string]*ecdsa.PrivateKey
}

// NewPrivy publishes one key with kid "key-1".
func NewPrivy(t *testing.T) *Privy {
	t.Helper()
	p := &Privy{keys: map[string]*ecdsa.PrivateKey{}}
	p.AddKey(t, "key-1")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.Fetches.Add(1)
		p.mu.Lock()
		defer p.mu.Unlock()
		var jwks struct {
			Keys []map[string]string `json:"keys"`
		}
		for kid, key := range p.keys {
			point, _ := key.PublicKey.Bytes()
			jwks.Keys = append(jwks.Keys, map[string]string{"kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig",
				"kid": kid, "x": base64.RawURLEncoding.EncodeToString(point[1:33]),
				"y": base64.RawURLEncoding.EncodeToString(point[33:])})
		}
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(srv.Close)
	p.JWKSURL = srv.URL
	return p
}

// AddKey publishes a new signing key.
func (p *Privy) AddKey(t *testing.T, kid string) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.keys[kid] = key
	return key
}

// RemoveKey stops publishing a key, as Privy would after rotating or revoking it.
func (p *Privy) RemoveKey(kid string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.keys, kid)
}

// Key returns a published key.
func (p *Privy) Key(kid string) *ecdsa.PrivateKey {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.keys[kid]
}

// Sign makes an ES256 token with the given kid header ("" for none), signed by key.
func Sign(t *testing.T, key *ecdsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	if kid != "" {
		token.Header["kid"] = kid
	}
	s, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
