// Package config reads every environment variable the binaries use. Locally they come from apps/backend/.env
// (copy .env.example); nothing has a default.
package config

import (
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

type API struct {
	DatabaseURL  string
	Addr         string
	PrivyAppID   string
	PrivyJWKSURL string
	// PrivyAppSecret lets the api make profile wallets: never log it.
	PrivyAppSecret string
	ChainsFile     string
	InfuraKeys     []string
	RPCRate        float64
	// PublicWebURL is the web app's origin, such as https://forwend.app: PDFs link to its /pay/<payToken> page.
	PublicWebURL string
	// UserBurst is each signed-in user's burst of requests; 0 keeps the default (mid.UserBurst). Only the live e2e,
	// whose tests all run as one user, sets it.
	UserBurst int
}

type Worker struct {
	DatabaseURL string
	Chains      Chains
	Email       Email
	// RatesURL is the ECB's reference rates file (R-110); ECB_RATES_URL is set only by tests that run a fake.
	RatesURL string
}

// Email is the owner's email (R-80, D-65). Without ResendKey the worker sends nothing and the events wait.
type Email struct {
	ResendKey    string // send-only Resend API key; never log it
	ResendURL    string // Resend's send endpoint; set only by tests that run a fake
	From         string // the sender, on the domain Resend verified
	PublicWebURL string
	// PostalAddress is the sender's address for each email's footer; empty leaves it out (Q-13).
	PostalAddress string
}

// DefaultRatesURL is the ECB's file of the last 90 days of euro reference rates: a wallet made after the worker's first
// read has no older transfers.
const DefaultRatesURL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"

const DefaultEmailFrom = "Forwend <notifications@mail.forwend.com>"

type Chains struct {
	File         string   // the chain list, packages/contracts/chains.json in a checkout
	InfuraKeys   []string // used before public RPCs; none: public RPCs only
	RPCRate      float64  // most calls per second to each RPC endpoint (an Infura key or a public URL)
	PollInterval time.Duration
}

// Signer's ExecutorKey is read from a hex private key: never log it.
type Signer struct {
	DatabaseURL string
	Chains      Chains
	ExecutorKey *ecdsa.PrivateKey
}

// Canary is what cmd/canary needs: its own factory, code hash and RPCs, never the api's (R-51).
type Canary struct {
	APIURL, WebURL  string
	Factory         string
	FactoryCodeHash string               // keccak256 of the factory's runtime code, lowercase 0x hex
	RPCURLs         map[uint64][2]string // two RPCs on different hosts per chain ID; may hold keys: never log
	PageScript      string               // apps/web/scripts/canary-pay-page.ts, run with node
}

func LoadAPI() (API, error) {
	var r reader
	c := API{DatabaseURL: r.get("DATABASE_URL"), Addr: r.get("API_ADDR"),
		PrivyAppID: r.get("PRIVY_APP_ID"), PrivyJWKSURL: r.keysURL("PRIVY_JWKS_URL"), PrivyAppSecret: r.get("PRIVY_APP_SECRET"),
		ChainsFile: r.get("CHAINS_FILE"), InfuraKeys: r.infuraKeys(), RPCRate: r.rate(),
		PublicWebURL: r.origin("PUBLIC_WEB_URL"), UserBurst: r.count("API_USER_BURST")}
	return c, r.err()
}

func LoadWorker() (Worker, error) {
	var r reader
	c := Worker{DatabaseURL: r.get("DATABASE_URL"), Chains: r.chains(),
		Email: Email{ResendKey: os.Getenv("RESEND_API_KEY"), ResendURL: os.Getenv("RESEND_API_URL"),
			PostalAddress: os.Getenv("EMAIL_POSTAL_ADDRESS"),
			From:          os.Getenv("EMAIL_FROM")}}
	if c.Email.From == "" {
		c.Email.From = DefaultEmailFrom
	}
	if c.RatesURL = os.Getenv("ECB_RATES_URL"); c.RatesURL == "" {
		c.RatesURL = DefaultRatesURL
	}
	if c.Email.ResendKey != "" {
		c.Email.PublicWebURL = r.origin("PUBLIC_WEB_URL")
	}
	return c, r.err()
}

func LoadDatabaseURL() (string, error) {
	var r reader
	url := r.get("DATABASE_URL")
	return url, r.err()
}

func LoadSigner() (Signer, error) {
	var r reader
	c := Signer{DatabaseURL: r.get("DATABASE_URL"), Chains: r.chains(), ExecutorKey: r.key("EXECUTOR_PRIVATE_KEY")}
	return c, r.err()
}

func LoadCanary() (Canary, error) {
	var r reader
	c := Canary{APIURL: r.origin("CANARY_API_URL"), WebURL: r.origin("CANARY_WEB_URL"),
		Factory: r.hex("CANARY_FACTORY", 20), FactoryCodeHash: r.hex("CANARY_FACTORY_CODE_HASH", 32),
		RPCURLs: r.rpcPairs("CANARY_RPC_URLS"), PageScript: r.get("CANARY_PAGE_SCRIPT")}
	return c, r.err()
}

func (r *reader) hex(name string, bytes int) string {
	raw := r.get(name)
	if raw == "" {
		return ""
	}
	if !regexp.MustCompile(fmt.Sprintf("^0x[0-9a-fA-F]{%d}$", 2*bytes)).MatchString(raw) {
		r.invalid = append(r.invalid, fmt.Sprintf("%s (0x and %d hex digits)", name, 2*bytes))
	}
	return strings.ToLower(raw)
}

// rpcPairs never puts the URLs into an error: they may hold keys.
func (r *reader) rpcPairs(name string) map[uint64][2]string {
	raw := r.get(name)
	if raw == "" {
		return nil
	}
	var in map[uint64][]string
	ok := json.Unmarshal([]byte(raw), &in) == nil && len(in) > 0
	out := map[uint64][2]string{}
	for chainID, urls := range in {
		if len(urls) != 2 {
			ok = false
			break
		}
		a, b := webURL(urls[0]), webURL(urls[1])
		if a == nil || b == nil || a.Host == b.Host {
			ok = false
			break
		}
		out[chainID] = [2]string(urls)
	}
	if !ok {
		r.invalid = append(r.invalid, name+` (JSON such as {"84532": ["https://rpc-a", "https://rpc-b"]}: two URLs on `+
			"different hosts per chain ID)")
	}
	return out
}

func webURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil
	}
	return u
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

// key never puts the value into an error.
func (r *reader) key(name string) *ecdsa.PrivateKey {
	raw := r.get(name)
	if raw == "" {
		return nil
	}
	k, err := crypto.HexToECDSA(strings.TrimPrefix(raw, "0x"))
	if err != nil {
		r.invalid = append(r.invalid, name+" (a hex secp256k1 private key)")
	}
	return k
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

// keysURL must be https: anyone on the path of a plain-http key list could sign tokens for any user. Loopback http is
// for tests.
func (r *reader) keysURL(name string) string {
	raw := r.get(name)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	loopback := err == nil && (u.Hostname() == "localhost" || net.ParseIP(u.Hostname()).IsLoopback())
	if err != nil || u.Host == "" || !(u.Scheme == "https" || u.Scheme == "http" && loopback) {
		r.invalid = append(r.invalid, name+" (an https URL)")
		return ""
	}
	return raw
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

func (r *reader) count(name string) int {
	raw := os.Getenv(name)
	if raw == "" {
		return 0
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		r.invalid = append(r.invalid, name+" (a whole number above 0)")
	}
	return v
}

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
