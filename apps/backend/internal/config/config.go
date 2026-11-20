// Package config reads every environment variable the binaries use; locally from apps/backend/.env.
package config

import (
	"crypto/ecdsa"
	"math/big"
	"os"
	"time"
)

type API struct {
	DatabaseURL       string
	Addr              string
	PrivyAppID        string
	PrivyJWKSURL      string
	PrivyAppSecret    string  // never log
	RPCSecrets        Secrets `json:"-"`
	RPCAllowLoopback  bool
	RPCRate           float64
	PublicWebURL      string
	UserBurst         int // 0 keeps mid.UserBurst
	TrustProxyHeader  bool
	CodesPerHour      int // 0 keeps reauth.MaxPerHour
	EnableTestnetUSDC bool
	EnableMainnets    []uint64
	Email             Email
	WebhookKey        []byte // 32 bytes; nil leaves webhooks off; never log
	Fees              Fees
	OneClick          OneClick
	CrossChainOff     bool
}

// OneClick is NEAR Intents' 1Click API. Signer replaces its pinned quote key, only for a loopback test fake.
type OneClick struct {
	URL, Key, Signer string // Key: optional partner key; never log
}

const DefaultOneClickURL = "https://1click.chaindefuser.com"

// Fees is the platform fee: RateBps of the price, at least MinUSD, at most CapUSD (nil: no cap).
type Fees struct {
	RateBps        int64
	MinUSD, CapUSD *big.Rat
}

type Worker struct {
	DatabaseURL string
	Chains      Chains
	Email       Email
	RatesURL    string
	Prices      Prices
	Fees        Fees // for a retainer's later months
	OneClick    OneClick
}

// Prices is CoinGecko for the stablecoins' display prices.
type Prices struct {
	URL   string
	Key   string // optional Demo plan key; never log
	Every time.Duration
}

// Webhooks is what cmd/webhooks needs: the database and the key that opens the signing secrets, nothing else.
type Webhooks struct {
	DatabaseURL string
	WebhookKey  []byte // nil: nothing is sent; never log
}

// Email is the owner's email settings; without ResendKey the worker sends nothing and the events wait.
type Email struct {
	ResendKey     string // send-only Resend API key; never log it
	ResendURL     string // Resend's send endpoint; set only by tests that run a fake
	From          string // the sender, on the domain Resend verified
	PublicWebURL  string
	PostalAddress string // "" leaves it out of the footer
	Support       string // "" leaves the line out
}

// defaultRatesURL has 90 days of ECB rates: a wallet made after the worker's first read has no older transfers.
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

type Signer struct {
	DatabaseURL string
	Chains      Chains
	ExecutorKey *ecdsa.PrivateKey // never log
}

// Ops is what cmd/ops needs to read a support case and queue a return: the database and the chains' RPCs, no key.
type Ops struct {
	DatabaseURL string
	Chains      Chains
}

// Canary is what cmd/canary needs: its own factory, code hash and RPCs, never the api's.
type Canary struct {
	AllowLoopback            bool
	APIURL, WebURL           string
	Factory                  string
	FactoryCodeHash          string               // keccak256 of the factory's runtime code, lowercase 0x hex
	FactoryFees              bool                 // its terms carry the fees (factory v2)
	RPCURLs                  map[uint64][2]string // two RPCs on different hosts per chain ID; may hold keys: never log
	PageScript               string               // apps/web/scripts/canary-pay-page.ts, run with node
	OneClickURL, OneClickKey string
}

// The canary's own copies of 1Click's root and quote key; CANARY_ONECLICK_URL and _KEY replace them for a fake.
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
