// Package config reads every environment variable the binaries use. Locally they come from apps/backend/.env
// (copy .env.example); nothing has a default.
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// API is what cmd/api needs.
type API struct {
	DatabaseURL string
	Addr        string
	// Privy app ID, and the URL of its published token signing keys (JWKS).
	PrivyAppID   string
	PrivyJWKSURL string
	// PrivyAppSecret lets the api make profile wallets: never log it.
	PrivyAppSecret string
}

// Worker is what cmd/worker needs.
type Worker struct {
	DatabaseURL string
	Chains      Chains
}

// Chains is how the worker and signer reach the chains.
type Chains struct {
	File         string        // the chain list, packages/contracts/chains.json in a checkout
	InfuraKeys   []string      // tried in order before public RPCs
	PollInterval time.Duration // time between rounds
}

// Signer is what cmd/signer needs. ExecutorKey is a hex private key: never log it.
type Signer struct {
	DatabaseURL string
	Chains      Chains
	ExecutorKey string
}

func LoadAPI() (API, error) {
	var r reader
	c := API{DatabaseURL: r.get("DATABASE_URL"), Addr: r.get("API_ADDR"),
		PrivyAppID: r.get("PRIVY_APP_ID"), PrivyJWKSURL: r.get("PRIVY_JWKS_URL"), PrivyAppSecret: r.get("PRIVY_APP_SECRET")}
	return c, r.err()
}

func LoadWorker() (Worker, error) {
	var r reader
	c := Worker{DatabaseURL: r.get("DATABASE_URL"), Chains: r.chains()}
	return c, r.err()
}

// LoadDatabaseURL is for tools and tests that only need the database.
func LoadDatabaseURL() (string, error) {
	var r reader
	url := r.get("DATABASE_URL")
	return url, r.err()
}

func LoadSigner() (Signer, error) {
	var r reader
	c := Signer{DatabaseURL: r.get("DATABASE_URL"), Chains: r.chains(), ExecutorKey: r.get("EXECUTOR_PRIVATE_KEY")}
	return c, r.err()
}

func (r *reader) chains() Chains {
	c := Chains{File: r.get("CHAINS_FILE")}
	for _, k := range strings.Split(r.get("INFURA_API_KEYS"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			c.InfuraKeys = append(c.InfuraKeys, k)
		}
	}
	if raw := r.get("POLL_INTERVAL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			r.invalid = append(r.invalid, "POLL_INTERVAL (a duration such as 5s)")
		}
		c.PollInterval = d
	}
	return c
}

// reader collects every missing or invalid variable, so one run names them all.
type reader struct{ missing, invalid []string }

func (r *reader) get(name string) string {
	v := os.Getenv(name)
	if v == "" {
		r.missing = append(r.missing, name)
	}
	return v
}

func (r *reader) err() error {
	var errs []error
	if len(r.missing) > 0 {
		errs = append(errs, fmt.Errorf("missing environment variables %s: copy apps/backend/.env.example to apps/backend/.env",
			strings.Join(r.missing, ", ")))
	}
	if len(r.invalid) > 0 {
		errs = append(errs, fmt.Errorf("invalid environment variables %s", strings.Join(r.invalid, ", ")))
	}
	return errors.Join(errs...)
}
