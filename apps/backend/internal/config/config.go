// Package config reads every environment variable the binaries use. Locally they come from apps/backend/.env
// (copy .env.example).
package config

import (
	"crypto/ecdsa"
	"math/big"
	"os"
	"time"
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
	// CrossChainOff stops new cross-chain quotes on the whole platform (R-240), as for an incident at NEAR Intents. The
	// worker still reads the open ones.
	CrossChainOff bool
}

// OneClick is NEAR Intents' 1Click API for cross-chain payments (D-123). URL is its root, DefaultOneClickURL when unset.
// Signer replaces the key its quotes must carry, 1Click's own pinned one (D-124), only for a test's fake on a loopback
// URL: startup refuses it with any other. Key is the optional partner key (Q-18): never log it.
type OneClick struct {
	URL, Key, Signer string
}

const DefaultOneClickURL = "https://1click.chaindefuser.com"

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

// defaultRatesURL is the ECB's file of the last 90 days of euro reference rates: a wallet made after the worker's first
// read has no older transfers.
const defaultRatesURL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"

const defaultEmailFrom = "Forwend <notifications@mail.forwend.com>"

const (
	defaultPricesURL   = "https://api.coingecko.com/api/v3"
	defaultPricesEvery = 15 * time.Minute
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
	// 1Click's API root and the key its quotes carry (D-124): the canary's own copies, never the api's (R-235).
	OneClickURL, OneClickKey string
}

// The canary's own copies of 1Click's root and quote key; CANARY_ONECLICK_URL and CANARY_ONECLICK_KEY replace them for
// a test's fake.
const (
	CanaryOneClickURL = "https://1click.chaindefuser.com"
	CanaryOneClickKey = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"
)

func LoadAPI() (API, error) {
	var r reader
	c := API{DatabaseURL: r.get("DATABASE_URL"), Addr: r.get("API_ADDR"),
		PrivyAppID: r.get("PRIVY_APP_ID"), PrivyJWKSURL: r.keysURL("PRIVY_JWKS_URL"), PrivyAppSecret: r.get("PRIVY_APP_SECRET"),
		RPCSecrets: r.rpcSecrets(), RPCAllowLoopback: r.flag("RPC_ALLOW_LOOPBACK"), RPCRate: r.rate(),
		PublicWebURL: r.origin("PUBLIC_WEB_URL"), UserBurst: r.count("API_USER_BURST"),
		TrustProxyHeader:  r.flag("TRUST_PROXY_HEADER"),
		CodesPerHour:      r.count("API_CODES_PER_HOUR"),
		EnableTestnetUSDC: r.flag("ENABLE_TESTNET_USDC"), EnableMainnets: r.chainIDs("ENABLE_MAINNETS"),
		WebhookKey: r.base64Key("WEBHOOK_SECRET_KEY"), Email: email(), Fees: r.fees(), OneClick: r.oneClick(),
		CrossChainOff: r.flag("CROSSCHAIN_OFF")}
	c.Email.PublicWebURL = c.PublicWebURL
	return c, r.err()
}

func LoadWorker() (Worker, error) {
	var r reader
	c := Worker{DatabaseURL: r.get("DATABASE_URL"), Chains: r.chains(), Email: email(), Fees: r.fees(), OneClick: r.oneClick()}
	if c.RatesURL = os.Getenv("ECB_RATES_URL"); c.RatesURL == "" {
		c.RatesURL = defaultRatesURL
	}
	c.Prices = Prices{URL: os.Getenv("COINGECKO_API_URL"), Key: os.Getenv("COINGECKO_API_KEY"), Every: defaultPricesEvery}
	if c.Prices.URL == "" {
		c.Prices.URL = defaultPricesURL
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
		RPCURLs:     r.rpcPairs("CANARY_RPC_URLS", allowLoopback), PageScript: r.get("CANARY_PAGE_SCRIPT"),
		OneClickURL: os.Getenv("CANARY_ONECLICK_URL"), OneClickKey: os.Getenv("CANARY_ONECLICK_KEY")}
	if c.OneClickURL == "" {
		c.OneClickURL = CanaryOneClickURL
	}
	r.oneClickFake("CANARY_ONECLICK_URL", c.OneClickURL, "CANARY_ONECLICK_KEY", c.OneClickKey)
	if c.OneClickKey == "" {
		c.OneClickKey = CanaryOneClickKey
	}
	return c, r.err()
}

type Secrets map[string]string

func (Secrets) String() string   { return "<redacted>" }
func (Secrets) GoString() string { return "<redacted>" }
