// Package auth checks who calls the API: Privy access tokens verified locally, and profile ownership (R-18).
package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrUnauthorized means the token is missing, malformed, expired, or not signed by Privy for this app.
var ErrUnauthorized = errors.New("invalid access token")

// ErrForbidden means the user does not own the profile, or it does not exist.
var ErrForbidden = errors.New("profile not owned by user")

// RefetchInterval is the shortest time between two JWKS fetches caused by tokens with an unknown kid.
const RefetchInterval = time.Minute

// Verifier checks Privy access tokens with the app's published signing keys (R-29). Keys are loaded at startup and
// fetched again only when a token names an unknown kid, at most once per RefetchInterval.
// ponytail: a key Privy withdraws stays trusted until such a refetch or a restart; add a timed refetch if that matters.
type Verifier struct {
	jwksURL string
	client  *http.Client
	parser  *jwt.Parser
	now     func() time.Time

	mu        sync.Mutex
	keys      map[string]*ecdsa.PublicKey
	fetchedAt time.Time
}

// NewVerifier loads the keys from the Privy JWKS URL; it fails if they can't be fetched.
func NewVerifier(ctx context.Context, appID, jwksURL string, client *http.Client) (*Verifier, error) {
	if appID == "" {
		return nil, errors.New("empty Privy app ID") // would accept a token with an empty audience
	}
	v := &Verifier{
		jwksURL: jwksURL,
		client:  client,
		now:     time.Now,
		parser: jwt.NewParser(
			jwt.WithValidMethods([]string{jwt.SigningMethodES256.Alg()}),
			jwt.WithIssuer("privy.io"),
			jwt.WithAudience(appID),
			jwt.WithExpirationRequired(),
		),
	}
	keys, err := v.fetch(ctx)
	if err != nil {
		return nil, err
	}
	v.keys, v.fetchedAt = keys, v.now()
	return v, nil
}

// Verify returns the user's Privy DID (the token's subject).
func (v *Verifier) Verify(ctx context.Context, token string) (string, error) {
	var claims jwt.RegisteredClaims
	_, err := v.parser.ParseWithClaims(token, &claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return v.keysFor(ctx, kid)
	})
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrUnauthorized, err)
	}
	if claims.Subject == "" {
		return "", fmt.Errorf("%w: no subject", ErrUnauthorized)
	}
	return claims.Subject, nil
}

// keysFor returns the key named kid, fetching the keys again if it is unknown and the last fetch is old enough.
// A token without a kid may match any published key.
// The lock is not held during the fetch, so known keys keep working while Privy answers.
func (v *Verifier) keysFor(ctx context.Context, kid string) (jwt.VerificationKeySet, error) {
	v.mu.Lock()
	if set, ok := v.lookup(kid); ok {
		v.mu.Unlock()
		return set, nil
	}
	if v.now().Sub(v.fetchedAt) < RefetchInterval {
		v.mu.Unlock()
		return jwt.VerificationKeySet{}, fmt.Errorf("unknown key id %q", kid)
	}
	v.fetchedAt = v.now() // also on failure, so a broken JWKS endpoint isn't called on every request
	v.mu.Unlock()

	// The fetch is shared: a caller that hangs up must not abort it and waste the slot. The client timeout bounds it.
	keys, err := v.fetch(context.WithoutCancel(ctx))
	if err != nil {
		return jwt.VerificationKeySet{}, err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.keys = keys
	if set, ok := v.lookup(kid); ok {
		return set, nil
	}
	return jwt.VerificationKeySet{}, fmt.Errorf("unknown key id %q", kid)
}

func (v *Verifier) lookup(kid string) (jwt.VerificationKeySet, bool) {
	var set jwt.VerificationKeySet
	for id, key := range v.keys {
		if kid == "" || id == kid {
			set.Keys = append(set.Keys, key)
		}
	}
	return set, len(set.Keys) > 0
}

// fetch reads the JWKS and keeps its ES256 P-256 signing keys.
func (v *Verifier) fetch(ctx context.Context) (map[string]*ecdsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch Privy JWKS: %w", err)
	}
	res, err := v.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch Privy JWKS: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch Privy JWKS: status %d", res.StatusCode)
	}
	var jwks struct {
		Keys []struct{ Kid, Kty, Crv, Alg, Use, X, Y string } `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("read Privy JWKS: %w", err)
	}
	keys := map[string]*ecdsa.PublicKey{}
	for _, k := range jwks.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" || k.Kid == "" || (k.Alg != "" && k.Alg != "ES256") || (k.Use != "" && k.Use != "sig") {
			continue
		}
		x, errX := base64.RawURLEncoding.DecodeString(k.X)
		y, errY := base64.RawURLEncoding.DecodeString(k.Y)
		if errX != nil || errY != nil || len(x) != 32 || len(y) != 32 {
			return nil, fmt.Errorf("read Privy JWKS: bad coordinates for key %q", k.Kid)
		}
		key, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), append(append([]byte{4}, x...), y...))
		if err != nil {
			return nil, fmt.Errorf("read Privy JWKS: key %q: %w", k.Kid, err)
		}
		keys[k.Kid] = key
	}
	if len(keys) == 0 {
		return nil, errors.New("read Privy JWKS: no ES256 P-256 signing keys")
	}
	return keys, nil
}
