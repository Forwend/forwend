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
	"slices"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrUnauthorized means the token is missing, malformed, expired, or not signed by Privy for this app.
var ErrUnauthorized = errors.New("invalid access token")

// ErrForbidden means the user does not own the profile, or it does not exist.
var ErrForbidden = errors.New("profile not owned by user")

// ErrReauthRequired means the action needs a token from a sign-in within FreshWindow, not from a refresh (D-49).
var ErrReauthRequired = errors.New("fresh sign-in required")

// FreshWindow is how old a token may be for a money action or another change D-63 names.
const FreshWindow = 5 * time.Minute

// Token is a verified access token: the user's Privy DID and when Privy issued it.
type Token struct {
	User     string
	IssuedAt time.Time
}

// IsFresh reports whether t comes from a sign-in, not a refresh: Privy sets an email or passkey account's
// latest_verified_at (signIns, Unix seconds) to the iat of the token that sign-in issues, and a refresh leaves it (S-8).
func IsFresh(t Token, now time.Time, signIns []int64) bool {
	return now.Sub(t.IssuedAt) <= FreshWindow && slices.Contains(signIns, t.IssuedAt.Unix())
}

// RefetchInterval is the shortest time between two JWKS fetches caused by tokens with an unknown kid.
const RefetchInterval = time.Minute

// MaxKeyAge is how long a fetched key list is trusted: after it, the next token refetches it, so a key Privy
// withdrew (rotated or revoked) stops verifying.
const MaxKeyAge = time.Hour

// KeyGrace is how much longer the last list still verifies while Privy can't be reached; past it, nothing does (R-30).
const KeyGrace = 10 * time.Minute

// Verifier checks Privy access tokens with the app's published signing keys (R-29). It refetches them for an unknown
// kid (at most once per RefetchInterval) or a list older than MaxKeyAge (R-30).
type Verifier struct {
	jwksURL string
	client  *http.Client
	parser  *jwt.Parser
	now     func() time.Time

	mu        sync.Mutex
	keys      map[string]*ecdsa.PublicKey
	fetchedAt time.Time // last successful fetch: the key list's age
	triedAt   time.Time // last attempt: limits fetches to one per RefetchInterval
}

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
	v.keys, v.fetchedAt, v.triedAt = keys, v.now(), v.now()
	return v, nil
}

// accessClaims: Privy signs identity tokens for the app too; they have no sid and carry
// linked_accounts, and must not work as bearer tokens.
type accessClaims struct {
	jwt.RegisteredClaims
	SessionID      string          `json:"sid"`
	LinkedAccounts json.RawMessage `json:"linked_accounts"`
}

func (v *Verifier) Verify(ctx context.Context, token string) (Token, error) {
	var claims accessClaims
	_, err := v.parser.ParseWithClaims(token, &claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return v.keysFor(ctx, kid)
	})
	if err != nil {
		return Token{}, fmt.Errorf("%w: %w", ErrUnauthorized, err)
	}
	if claims.Subject == "" {
		return Token{}, fmt.Errorf("%w: no subject", ErrUnauthorized)
	}
	if claims.SessionID == "" || claims.LinkedAccounts != nil {
		return Token{}, fmt.Errorf("%w: not an access token", ErrUnauthorized)
	}
	// No iat reads as the Unix epoch: before any sign-out cutoff, and never fresh.
	t := Token{User: claims.Subject, IssuedAt: time.Unix(0, 0)}
	if claims.IssuedAt != nil {
		t.IssuedAt = claims.IssuedAt.Time
	}
	return t, nil
}

// keysFor: a token without a kid may match any published key. The lock is not held during the fetch, so known keys
// keep working while Privy answers.
func (v *Verifier) keysFor(ctx context.Context, kid string) (jwt.VerificationKeySet, error) {
	v.mu.Lock()
	cached, known := v.lookup(kid)
	age := v.now().Sub(v.fetchedAt)
	usable := known && age < MaxKeyAge+KeyGrace
	switch {
	case known && age < MaxKeyAge:
		v.mu.Unlock()
		return cached, nil
	case v.now().Sub(v.triedAt) < RefetchInterval:
		// Tried recently: a failed attempt must not count as a fresh list, nor be retried on every request.
		v.mu.Unlock()
		if usable {
			return cached, nil
		}
		return jwt.VerificationKeySet{}, fmt.Errorf("unknown or stale key id %q", kid)
	}
	v.triedAt = v.now()
	v.mu.Unlock()

	// The fetch is shared: a caller that hangs up must not abort it and waste the slot. The client timeout bounds it.
	keys, err := v.fetch(context.WithoutCancel(ctx))
	if err != nil {
		if usable {
			return cached, nil
		}
		return jwt.VerificationKeySet{}, err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.keys, v.fetchedAt = keys, v.now()
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
