// Package config reads every environment variable the binaries use. Locally they come from apps/backend/.env
// (copy .env.example); nothing has a default.
package config

import (
	"fmt"
	"os"
	"strings"
)

// API is what cmd/api needs.
type API struct {
	DatabaseURL string
	Addr        string
	// Privy app ID, and the URL of its published token signing keys (JWKS).
	PrivyAppID   string
	PrivyJWKSURL string
}

// Worker is what cmd/worker and cmd/signer need for now.
type Worker struct {
	DatabaseURL string
}

func LoadAPI() (API, error) {
	var r reader
	c := API{DatabaseURL: r.get("DATABASE_URL"), Addr: r.get("API_ADDR"),
		PrivyAppID: r.get("PRIVY_APP_ID"), PrivyJWKSURL: r.get("PRIVY_JWKS_URL")}
	return c, r.err()
}

func LoadWorker() (Worker, error) {
	var r reader
	c := Worker{DatabaseURL: r.get("DATABASE_URL")}
	return c, r.err()
}

// reader collects every missing variable, so one run names them all.
type reader struct{ missing []string }

func (r *reader) get(name string) string {
	v := os.Getenv(name)
	if v == "" {
		r.missing = append(r.missing, name)
	}
	return v
}

func (r *reader) err() error {
	if len(r.missing) == 0 {
		return nil
	}
	return fmt.Errorf("missing environment variables %s: copy apps/backend/.env.example to apps/backend/.env",
		strings.Join(r.missing, ", "))
}
