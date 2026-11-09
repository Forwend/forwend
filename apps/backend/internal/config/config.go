// Package config reads every environment variable the binaries use. Locally they come from apps/backend/.env
// (copy .env.example).
package config

import (
	"crypto/ecdsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

type API struct {
	DatabaseURL  string
	Addr         string
	PrivyAppID   string
	PrivyJWKSURL string
	// PrivyAppSecret lets the api make profile wallets: never log it.
	PrivyAppSecret   string
	RPCSecrets       Secrets `json:"-"`
	RPCAllowLoopback bool
	RPCRate          float64
	// PublicWebURL is the web app's origin, such as https://forwend.app: PDFs link to its /pay/<payToken> page.
	PublicWebURL string
	// UserBurst is each signed-in user's burst of requests; 0 keeps the default (mid.UserBurst). Only the live e2e,
	// whose tests all run as one user, sets it.
	UserBurst int
	// TrustProxyHeader: a proxy in front (such as Traefik) sets X-Forwarded-For to the client's address, so public
	// limits can count per payer. Off, the header is the client's own and is ignored.
	TrustProxyHeader bool
	// CodesPerHour is each user's Confirm it's you codes an hour; 0 keeps reauth.MaxPerHour. Only the live e2e, whose
	// one test account confirms on every run against a lasting database, sets it.
	CodesPerHour      int
	EnableTestnetUSDC bool
	// EnableMainnets are the live chains API startup switches on (R-222); the owner names each one.
	EnableMainnets []uint64
	// Email sends Confirm it's you codes (R-137); without a key no code can be sent, so protected changes need a
	// full sign-in.
	Email Email
	// WebhookKey seals webhook signing secrets (R-146): 32 bytes, or nil to leave webhooks off. Never log it.
	WebhookKey []byte
	Fees       Fees
	OneClick   OneClick
}

// OneClick is NEAR Intents' 1Click API for cross-chain payments (D-123). URL is its root, DefaultOneClickURL when unset;
// Signer is the key its quotes must carry, 1Click's own when unset. Only tests that run a fake set ONECLICK_API_URL and
// ONECLICK_SIGNER_KEY. Key is the optional partner key (Q-18): never log it.
type OneClick struct {
	URL, Key, Signer string
}

const DefaultOneClickURL = "https://1click.chaindefuser.com"

func oneClick() OneClick {
	c := OneClick{URL: os.Getenv("ONECLICK_API_URL"), Key: os.Getenv("ONECLICK_API_KEY"), Signer: os.Getenv("ONECLICK_SIGNER_KEY")}
	if c.URL == "" {
		c.URL = DefaultOneClickURL
	}
	return c
}

// Fees is the platform fee plan (D-122) the api and the worker quote new invoices with: PLATFORM_FEE_BPS of the price,
// at least PLATFORM_FEE_MIN_USD and at most PLATFORM_FEE_CAP_USD (unset: no cap). Unset, the rate is 0.
type Fees struct {
	RateBps        int64
	MinUSD, CapUSD *big.Rat
}

type Worker struct {
	DatabaseURL string
	Chains      Chains
	Email       Email
	// RatesURL is the ECB's reference rates file (R-110); ECB_RATES_URL is set only by tests that run a fake.
	RatesURL string
	Prices   Prices
	Fees     Fees // for a retainer's later months
	OneClick OneClick
}

// Prices is CoinGecko for the stablecoins' display prices (R-178). URL is its API root; COINGECKO_API_URL is set only
// by tests that run a fake. Key is the optional Demo plan key: never log it.
type Prices struct {
	URL   string
	Key   string
	Every time.Duration
}

// Webhooks is what cmd/webhooks needs (R-148): the database and the key that opens the signing secrets, nothing else.
type Webhooks struct {
	DatabaseURL string
	// WebhookKey opens the signing secrets: 32 bytes, or nil, and nothing is sent. Never log it.
	WebhookKey []byte
}

// Email is the owner's email (R-80, D-65). Without ResendKey the worker sends nothing and the events wait.
type Email struct {
	ResendKey    string // send-only Resend API key; never log it
	ResendURL    string // Resend's send endpoint; set only by tests that run a fake
	From         string // the sender, on the domain Resend verified
	PublicWebURL string
	// PostalAddress is the sender's address for each email's footer; empty leaves it out (Q-13).
	PostalAddress string
	// Support is where readers write with questions, named in each footer; empty leaves the line out.
	Support string
}

// DefaultRatesURL is the ECB's file of the last 90 days of euro reference rates: a wallet made after the worker's first
// read has no older transfers.
const DefaultRatesURL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"

const DefaultEmailFrom = "Forwend <notifications@mail.forwend.com>"

const (
	DefaultPricesURL   = "https://api.coingecko.com/api/v3"
	DefaultPricesEvery = 15 * time.Minute
)

type Chains struct {
	RPCSecrets    Secrets `json:"-"`
	AllowLoopback bool
	RPCRate       float64
	PollInterval  time.Duration
}

// Signer's ExecutorKey is read from a hex private key: never log it.
type Signer struct {
	DatabaseURL string
	Chains      Chains
	ExecutorKey *ecdsa.PrivateKey
}

// Ops is what cmd/ops needs to read a support case and queue a return: the database and the chains' RPCs, no key.
type Ops struct {
	DatabaseURL string
	Chains      Chains
}

// Canary is what cmd/canary needs: its own factory, code hash and RPCs, never the api's (R-51).
type Canary struct {
	AllowLoopback   bool
	APIURL, WebURL  string
	Factory         string
	FactoryCodeHash string               // keccak256 of the factory's runtime code, lowercase 0x hex
	FactoryFees     bool                 // its terms carry the fees (factory v2 on, R-226)
	RPCURLs         map[uint64][2]string // two RPCs on different hosts per chain ID; may hold keys: never log
	PageScript      string               // apps/web/scripts/canary-pay-page.ts, run with node
}

func LoadAPI() (API, error) {
	var r reader
	c := API{DatabaseURL: r.get("DATABASE_URL"), Addr: r.get("API_ADDR"),
		PrivyAppID: r.get("PRIVY_APP_ID"), PrivyJWKSURL: r.keysURL("PRIVY_JWKS_URL"), PrivyAppSecret: r.get("PRIVY_APP_SECRET"),
		RPCSecrets: r.rpcSecrets(), RPCAllowLoopback: r.flag("RPC_ALLOW_LOOPBACK"), RPCRate: r.rate(),
		PublicWebURL: r.origin("PUBLIC_WEB_URL"), UserBurst: r.count("API_USER_BURST"),
		TrustProxyHeader:  r.flag("TRUST_PROXY_HEADER"),
		CodesPerHour:      r.count("API_CODES_PER_HOUR"),
		EnableTestnetUSDC: r.flag("ENABLE_TESTNET_USDC"), EnableMainnets: r.chainIDs("ENABLE_MAINNETS"),
		WebhookKey: r.base64Key("WEBHOOK_SECRET_KEY"), Email: email(), Fees: r.fees(), OneClick: oneClick()}
	c.Email.PublicWebURL = c.PublicWebURL
	return c, r.err()
}

// email is the optional Resend settings the api and the worker share; an empty key sends nothing.
func email() Email {
	e := Email{ResendKey: os.Getenv("RESEND_API_KEY"), ResendURL: os.Getenv("RESEND_API_URL"),
		PostalAddress: os.Getenv("EMAIL_POSTAL_ADDRESS"), Support: os.Getenv("SUPPORT_EMAIL"), From: os.Getenv("EMAIL_FROM")}
	if e.From == "" {
		e.From = DefaultEmailFrom
	}
	return e
}

func LoadWorker() (Worker, error) {
	var r reader
	c := Worker{DatabaseURL: r.get("DATABASE_URL"), Chains: r.chains(), Email: email(), Fees: r.fees(), OneClick: oneClick()}
	if c.RatesURL = os.Getenv("ECB_RATES_URL"); c.RatesURL == "" {
		c.RatesURL = DefaultRatesURL
	}
	c.Prices = Prices{URL: os.Getenv("COINGECKO_API_URL"), Key: os.Getenv("COINGECKO_API_KEY"), Every: DefaultPricesEvery}
	if c.Prices.URL == "" {
		c.Prices.URL = DefaultPricesURL
	}
	// Keyless calls allow a few a minute and the Demo key 10,000 a month; every 15 minutes is about 3,000.
	if raw := os.Getenv("COINGECKO_INTERVAL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d < time.Minute {
			r.invalid = append(r.invalid, "COINGECKO_INTERVAL (a duration of at least 1m, such as 15m)")
		}
		c.Prices.Every = d
	}
	if c.Email.ResendKey != "" {
		c.Email.PublicWebURL = r.origin("PUBLIC_WEB_URL")
	}
	return c, r.err()
}

func LoadWebhooks() (Webhooks, error) {
	var r reader
	c := Webhooks{DatabaseURL: r.get("DATABASE_URL"), WebhookKey: r.base64Key("WEBHOOK_SECRET_KEY")}
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

func LoadOps() (Ops, error) {
	var r reader
	c := Ops{DatabaseURL: r.get("DATABASE_URL"), Chains: r.chains()}
	return c, r.err()
}

func LoadCanary() (Canary, error) {
	var r reader
	allowLoopback := r.flag("RPC_ALLOW_LOOPBACK")
	c := Canary{AllowLoopback: allowLoopback, APIURL: r.origin("CANARY_API_URL"), WebURL: r.origin("CANARY_WEB_URL"),
		Factory: r.hex("CANARY_FACTORY", 20), FactoryCodeHash: r.hex("CANARY_FACTORY_CODE_HASH", 32),
		FactoryFees: r.flag("CANARY_FACTORY_FEES"),
		RPCURLs:     r.rpcPairs("CANARY_RPC_URLS", allowLoopback), PageScript: r.get("CANARY_PAGE_SCRIPT")}
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
func (r *reader) rpcPairs(name string, allowLoopback bool) map[uint64][2]string {
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
		if a == nil || b == nil || !outbound.ValidURL(urls[0], allowLoopback) || !outbound.ValidURL(urls[1], allowLoopback) ||
			strings.EqualFold(strings.TrimSuffix(a.Hostname(), "."), strings.TrimSuffix(b.Hostname(), ".")) {
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
	c := Chains{RPCSecrets: r.rpcSecrets(), AllowLoopback: r.flag("RPC_ALLOW_LOOPBACK"), RPCRate: r.rate()}
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

func (r *reader) flag(name string) bool {
	raw := os.Getenv(name)
	if raw != "" && raw != "0" && raw != "1" {
		r.invalid = append(r.invalid, name+" (0 or 1)")
	}
	return raw == "1"
}

// base64Key is 32 bytes in standard base64, or nil when unset.
func (r *reader) base64Key(name string) []byte {
	raw := os.Getenv(name)
	if raw == "" {
		return nil
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		r.invalid = append(r.invalid, name+" (32 bytes in base64)")
	}
	return key
}

// chainIDs is a comma-separated list of chain IDs, or nil when unset.
func (r *reader) chainIDs(name string) []uint64 {
	raw := os.Getenv(name)
	if raw == "" {
		return nil
	}
	var ids []uint64
	for part := range strings.SplitSeq(raw, ",") {
		id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err != nil || id == 0 {
			r.invalid = append(r.invalid, name+" (chain IDs separated by commas, such as 8453,42161)")
			return nil
		}
		ids = append(ids, id)
	}
	return ids
}

// fees reads the platform fee plan. The contract takes at most a tenth of the amount in fees, network fee included, so
// a rate is at most 500 basis points.
func (r *reader) fees() Fees {
	var f Fees
	if raw := os.Getenv("PLATFORM_FEE_BPS"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 || v > 500 {
			r.invalid = append(r.invalid, "PLATFORM_FEE_BPS (basis points from 0 to 500, such as 50 for 0.5%)")
		}
		f.RateBps = v
	}
	usd := func(name string) *big.Rat {
		raw := os.Getenv(name)
		if raw == "" {
			return nil
		}
		v, ok := new(big.Rat).SetString(raw)
		if !ok || v.Sign() < 0 || !regexp.MustCompile(`^\d+(\.\d{1,2})?$`).MatchString(raw) {
			r.invalid = append(r.invalid, name+" (USD with at most 2 decimals, such as 0.50)")
			return nil
		}
		return v
	}
	f.MinUSD, f.CapUSD = usd("PLATFORM_FEE_MIN_USD"), usd("PLATFORM_FEE_CAP_USD")
	if f.MinUSD != nil && f.CapUSD != nil && f.MinUSD.Cmp(f.CapUSD) > 0 {
		r.invalid = append(r.invalid, "PLATFORM_FEE_MIN_USD (at most PLATFORM_FEE_CAP_USD)")
	}
	return f
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

type Secrets map[string]string

func (Secrets) String() string   { return "<redacted>" }
func (Secrets) GoString() string { return "<redacted>" }

func (r *reader) rpcSecrets() Secrets {
	raw := os.Getenv("RPC_ENDPOINT_SECRETS")
	if raw == "" {
		return nil
	}
	var secrets Secrets
	if json.Unmarshal([]byte(raw), &secrets) != nil || secrets == nil {
		r.invalid = append(r.invalid, "RPC_ENDPOINT_SECRETS (JSON object of secret references to URLs)")
		return nil
	}
	for name, value := range secrets {
		if !regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`).MatchString(name) || value == "" {
			r.invalid = append(r.invalid, "RPC_ENDPOINT_SECRETS (invalid reference or empty URL)")
			return nil
		}
	}
	return secrets
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
