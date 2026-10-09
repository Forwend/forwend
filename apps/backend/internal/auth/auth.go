// Package auth checks who calls the API: Privy access tokens verified locally, and profile ownership (R-18).
package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"errors"
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// ErrUnauthorized means the token is missing, malformed, expired, or not signed by Privy for this app.
var ErrUnauthorized = errors.New("invalid access token")

// ErrForbidden means the user does not own the profile, or it does not exist.
var ErrForbidden = errors.New("profile not owned by user")

// Verifier checks Privy access tokens with the app's verification key: no network call per request.
type Verifier struct {
	key    *ecdsa.PublicKey
	parser *jwt.Parser
}

// NewVerifier takes the Privy app ID and the PEM verification key from the Privy dashboard. Literal "\n" sequences
// (a key kept on one line in .env) become newlines.
func NewVerifier(appID, verificationKeyPEM string) (*Verifier, error) {
	key, err := jwt.ParseECPublicKeyFromPEM([]byte(strings.ReplaceAll(verificationKeyPEM, `\n`, "\n")))
	if err != nil {
		return nil, fmt.Errorf("parse Privy verification key: %w", err)
	}
	if key.Curve != elliptic.P256() {
		return nil, errors.New("parse Privy verification key: not a P-256 key")
	}
	return &Verifier{
		key: key,
		parser: jwt.NewParser(
			jwt.WithValidMethods([]string{jwt.SigningMethodES256.Alg()}),
			jwt.WithIssuer("privy.io"),
			jwt.WithAudience(appID),
			jwt.WithExpirationRequired(),
		),
	}, nil
}

// Verify returns the user's Privy DID (the token's subject).
func (v *Verifier) Verify(token string) (string, error) {
	var claims jwt.RegisteredClaims
	_, err := v.parser.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) { return v.key, nil })
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrUnauthorized, err)
	}
	if claims.Subject == "" {
		return "", fmt.Errorf("%w: no subject", ErrUnauthorized)
	}
	return claims.Subject, nil
}
