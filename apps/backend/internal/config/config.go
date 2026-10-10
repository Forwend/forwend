// Package config reads every environment variable the binaries use. Locally they come from apps/backend/.env
// (copy .env.example); nothing has a default.
package config

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"strconv"
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
	// ChainsFile, InfuraKeys and RPCRate reach the chains for wallet balances, as in Chains.
	ChainsFile string
	InfuraKeys []string
	RPCRate    float64
	// PublicWebURL is the web app's origin, such as https://forwend.app: PDFs link to its /pay/<invoiceId> page.
	PublicWebURL string
}

// Worker is what cmd/worker needs.
type Worker struct {
	DatabaseURL string
	Chains      Chains
}

// Chains is how the worker and signer reach the chains.
type Chains struct {
	File         string        // the chain list, packages/contracts/chains.json in a checkout
	InfuraKeys   []string      // used before public RPCs; none: public RPCs only
	RPCRate      float64       // most calls per second to each RPC endpoint (an Infura key or a public URL)
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
		PrivyAppID: r.get("PRIVY_APP_ID"), PrivyJWKSURL: r.get("PRIVY_JWKS_URL"), PrivyAppSecret: r.get("PRIVY_APP_SECRET"),
		ChainsFile: r.get("CHAINS_FILE"), InfuraKeys: r.infuraKeys(), RPCRate: r.rate(),
		PublicWebURL: r.origin("PUBLIC_WEB_URL")}
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
	c := Chains{File: r.get("CHAINS_FILE"), InfuraKeys: r.infuraKeys(), RPCRate: r.rate()}
	if raw := r.get("POLL_INTERVAL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			r.invalid = append(r.invalid, "POLL_INTERVAL (a duration such as 5s)")
		}
		c.PollInterval = d
	}
	return c
}

func (r *reader) origin(name string) string {
	raw := r.get(name)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		r.invalid = append(r.invalid, name+" (an origin such as https://forwend.app)")
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func (r *reader) rate() float64 {
	raw := r.get("RPC_RATE_PER_SECOND")
	if raw == "" {
		return 0
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || !(v > 0) || math.IsInf(v, 1) {
		r.invalid = append(r.invalid, "RPC_RATE_PER_SECOND (calls per second, such as 10)")
	}
	return v
}

// infuraKeys may be empty: the chains are then reached through public RPCs only.
func (r *reader) infuraKeys() []string {
	var keys []string
	for _, k := range strings.Split(os.Getenv("INFURA_API_KEYS"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			keys = append(keys, k)
		}
	}
	return keys
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
