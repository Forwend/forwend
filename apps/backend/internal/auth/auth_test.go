package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"
)

func publicPEM(t *testing.T, curve elliptic.Curve) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func TestNewVerifierKeys(t *testing.T) {
	// A key kept on one line in .env has literal \n sequences.
	oneLine := strings.ReplaceAll(publicPEM(t, elliptic.P256()), "\n", `\n`)
	if _, err := NewVerifier("app", oneLine); err != nil {
		t.Fatalf("one-line P-256 key: %v", err)
	}
	if _, err := NewVerifier("app", publicPEM(t, elliptic.P384())); err == nil {
		t.Fatal("P-384 key accepted; ES256 needs P-256")
	}
	if _, err := NewVerifier("app", "not a key"); err == nil {
		t.Fatal("garbage key accepted")
	}
}
