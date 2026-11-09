package config_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/config"
)

func TestAPI(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("API_ADDR", ":9")
	t.Setenv("PRIVY_APP_ID", "app")
	t.Setenv("PRIVY_JWKS_URL", "https://jwks")
	t.Setenv("PRIVY_APP_SECRET", "secret")
	t.Setenv("RPC_ALLOW_LOOPBACK", "0")
	t.Setenv("RPC_ENDPOINT_SECRETS", `{"FIRST":"https://a.example/private","SECOND":"https://b.example/private"}`)
	t.Setenv("RPC_RATE_PER_SECOND", "2.5")
	t.Setenv("PUBLIC_WEB_URL", "https://forwend.app/")
	t.Setenv("API_USER_BURST", "")
	t.Setenv("ENABLE_TESTNET_USDC", "")
	got, err := config.LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if got.DatabaseURL != "postgres://x" || got.Addr != ":9" || got.PrivyAppID != "app" || got.PrivyJWKSURL != "https://jwks" ||
		got.PrivyAppSecret != "secret" || got.RPCAllowLoopback || got.RPCSecrets["SECOND"] != "https://b.example/private" ||
		got.RPCRate != 2.5 || got.PublicWebURL != "https://forwend.app" || got.UserBurst != 0 || got.EnableTestnetUSDC {
		t.Fatalf("got %+v", got)
	}
	for _, value := range []string{"1", "0"} {
		t.Setenv("ENABLE_TESTNET_USDC", value)
		if got, err := config.LoadAPI(); err != nil || got.EnableTestnetUSDC != (value == "1") {
			t.Fatalf("ENABLE_TESTNET_USDC=%s: %v, %v", value, got.EnableTestnetUSDC, err)
		}
	}
	t.Setenv("ENABLE_TESTNET_USDC", "yes")
	if _, err := config.LoadAPI(); err == nil || !strings.Contains(err.Error(), "ENABLE_TESTNET_USDC (0 or 1)") {
		t.Fatalf("invalid ENABLE_TESTNET_USDC: %v", err)
	}
	t.Setenv("ENABLE_TESTNET_USDC", "")
	t.Setenv("ENABLE_MAINNETS", "8453, 42161")
	if got, err := config.LoadAPI(); err != nil || !slices.Equal(got.EnableMainnets, []uint64{8453, 42161}) {
		t.Fatalf("ENABLE_MAINNETS=8453, 42161: %v, %v", got.EnableMainnets, err)
	}
	t.Setenv("ENABLE_MAINNETS", "base")
	if _, err := config.LoadAPI(); err == nil || !strings.Contains(err.Error(), "ENABLE_MAINNETS") {
		t.Fatalf("invalid ENABLE_MAINNETS: %v", err)
	}
	t.Setenv("ENABLE_MAINNETS", "")
	t.Setenv("API_USER_BURST", "1000")
	if got, err := config.LoadAPI(); err != nil || got.UserBurst != 1000 {
		t.Fatalf("API_USER_BURST=1000: %d %v", got.UserBurst, err)
	}
	for _, bad := range []string{"0", "-5", "many"} {
		t.Setenv("API_USER_BURST", bad)
		if _, err := config.LoadAPI(); err == nil || !strings.Contains(err.Error(), "API_USER_BURST (a whole number above 0)") {
			t.Fatalf("API_USER_BURST=%s: got %v", bad, err)
		}
	}
	t.Setenv("API_USER_BURST", "")
	t.Setenv("API_CODES_PER_HOUR", "500")
	if got, err := config.LoadAPI(); err != nil || got.CodesPerHour != 500 {
		t.Fatalf("API_CODES_PER_HOUR=500: %d %v", got.CodesPerHour, err)
	}
	t.Setenv("API_CODES_PER_HOUR", "")
	t.Setenv("PRIVY_JWKS_URL", "http://jwks.example")
	if _, err := config.LoadAPI(); err == nil || !strings.Contains(err.Error(), "PRIVY_JWKS_URL (an https URL)") {
		t.Fatalf("plain-http PRIVY_JWKS_URL: got %v", err)
	}
	t.Setenv("PRIVY_JWKS_URL", "http://127.0.0.1:9/jwks")
	if _, err := config.LoadAPI(); err != nil {
		t.Fatalf("loopback PRIVY_JWKS_URL: %v", err)
	}
	for _, bad := range []string{"forwend.app", "ftp://forwend.app", "https://"} {
		t.Setenv("PUBLIC_WEB_URL", bad)
		if _, err := config.LoadAPI(); err == nil || !strings.Contains(err.Error(), "invalid environment variables PUBLIC_WEB_URL") {
			t.Fatalf("PUBLIC_WEB_URL=%s: got %v", bad, err)
		}
	}
}

func TestAPINamesEveryMissingVariable(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("API_ADDR", "")
	t.Setenv("PRIVY_APP_ID", "")
	t.Setenv("PRIVY_JWKS_URL", "")
	t.Setenv("PRIVY_APP_SECRET", "")
	t.Setenv("RPC_ALLOW_LOOPBACK", "")
	t.Setenv("RPC_ENDPOINT_SECRETS", "")
	t.Setenv("RPC_RATE_PER_SECOND", "")
	t.Setenv("PUBLIC_WEB_URL", "")
	_, err := config.LoadAPI()
	if err == nil || !strings.Contains(err.Error(),
		"DATABASE_URL, API_ADDR, PRIVY_APP_ID, PRIVY_JWKS_URL, PRIVY_APP_SECRET, RPC_RATE_PER_SECOND, PUBLIC_WEB_URL") ||
		strings.Contains(err.Error(), "RPC_ENDPOINT_SECRETS") {
		t.Fatalf("got %v", err)
	}
}

func TestWorkerAndSigner(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "") // never a real key in a failure message
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("RPC_ALLOW_LOOPBACK", "0")
	t.Setenv("RPC_ENDPOINT_SECRETS", `{"FIRST":"https://a.example/private","SECOND":"https://b.example/private"}`)
	t.Setenv("RPC_RATE_PER_SECOND", "10")
	t.Setenv("POLL_INTERVAL", "3s")
	t.Setenv("EXECUTOR_PRIVATE_KEY", chaintest.Key)
	w, err := config.LoadWorker()
	if err != nil || w.Chains.AllowLoopback || len(w.Chains.RPCSecrets) != 2 || w.Chains.RPCSecrets["SECOND"] != "https://b.example/private" ||
		w.Chains.RPCRate != 10 || w.Chains.PollInterval != 3*time.Second {
		t.Fatalf("worker: %+v, %v", w, err)
	}
	s, err := config.LoadSigner()
	if err != nil || !strings.EqualFold(crypto.PubkeyToAddress(s.ExecutorKey.PublicKey).Hex(), chaintest.Sender) ||
		s.Chains.RPCRate != 10 {
		t.Fatalf("signer: %+v, %v", s.Chains, err)
	}
	t.Setenv("EXECUTOR_PRIVATE_KEY", "0xnot-a-key")
	if _, err := config.LoadSigner(); err == nil ||
		!strings.Contains(err.Error(), "invalid environment variables EXECUTOR_PRIVATE_KEY") || strings.Contains(err.Error(), "not-a-key") {
		t.Fatalf("bad key: got %v", err)
	}

	t.Setenv("RPC_ENDPOINT_SECRETS", "")
	if w, err := config.LoadWorker(); err != nil || len(w.Chains.RPCSecrets) != 0 {
		t.Fatalf("worker without private endpoints: %+v, %v", w, err)
	}

	t.Setenv("POLL_INTERVAL", "soon")
	t.Setenv("EXECUTOR_PRIVATE_KEY", "")
	_, err = config.LoadSigner()
	if err == nil || !strings.Contains(err.Error(), "EXECUTOR_PRIVATE_KEY") || !strings.Contains(err.Error(), "POLL_INTERVAL") {
		t.Fatalf("missing key and bad interval: got %v", err)
	}
	for _, bad := range []string{"0", "-1", "fast", "NaN", "Inf"} {
		t.Setenv("RPC_RATE_PER_SECOND", bad)
		if _, err := config.LoadWorker(); err == nil || !strings.Contains(err.Error(), "invalid environment variables RPC_RATE_PER_SECOND") {
			t.Fatalf("RPC_RATE_PER_SECOND=%s: got %v", bad, err)
		}
	}
}

func TestCanary(t *testing.T) {
	t.Setenv("CANARY_API_URL", "https://api.forwend.app")
	t.Setenv("CANARY_WEB_URL", "https://forwend.app")
	t.Setenv("CANARY_FACTORY", "0xf93da73F1308A9B34aAB78bF6D84F0BAcc600dd2")
	t.Setenv("CANARY_FACTORY_CODE_HASH", "0x"+strings.Repeat("Ab", 32))
	t.Setenv("CANARY_RPC_URLS", `{"84532": ["https://a.example/v3/secret", "https://b.example"]}`)
	t.Setenv("CANARY_PAGE_SCRIPT", "../web/scripts/canary-pay-page.ts")
	got, err := config.LoadCanary()
	if err != nil || got.APIURL != "https://api.forwend.app" || got.WebURL != "https://forwend.app" ||
		got.Factory != "0xf93da73f1308a9b34aab78bf6d84f0bacc600dd2" || got.FactoryCodeHash != "0x"+strings.Repeat("ab", 32) ||
		got.RPCURLs[84532] != [2]string{"https://a.example/v3/secret", "https://b.example"} ||
		got.PageScript != "../web/scripts/canary-pay-page.ts" {
		t.Fatalf("got %+v, %v", got, err)
	}
	// One RPC host twice is not a second opinion; a bad value is named, never shown.
	for _, bad := range []string{`{"84532": ["https://a.example/v3/secret", "https://a.example/v3/other"]}`,
		`{"84532": ["https://a.example/v3/secret"]}`,
		`{"84532": ["http://a.example/secret", "https://b.example"]}`,
		`{"84532": ["https://a.example/secret", "https://a.example.:443"]}`,
		`{"84532": ["https://user:secret@a.example", "https://b.example"]}`, `{"84532": ["https://a.example/v3/secret", "b.example"]}`, `{}`, "a,b"} {
		t.Setenv("CANARY_RPC_URLS", bad)
		if _, err := config.LoadCanary(); err == nil || !strings.Contains(err.Error(), "invalid environment variables CANARY_RPC_URLS") ||
			strings.Contains(err.Error(), "secret") {
			t.Fatalf("CANARY_RPC_URLS=%s: got %v", bad, err)
		}
	}
	t.Setenv("CANARY_FACTORY", "0x1234")
	t.Setenv("CANARY_FACTORY_CODE_HASH", "")
	if _, err := config.LoadCanary(); err == nil || !strings.Contains(err.Error(), "CANARY_FACTORY_CODE_HASH") ||
		!strings.Contains(err.Error(), "invalid environment variables CANARY_FACTORY (") {
		t.Fatalf("bad factory, missing hash: got %v", err)
	}
}

func TestRPCSecretsRejectMalformedInputWithoutEchoingIt(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test")
	t.Setenv("RPC_RATE_PER_SECOND", "10")
	t.Setenv("POLL_INTERVAL", "1s")
	t.Setenv("RESEND_API_KEY", "")
	for _, value := range []string{`{"KEY":"SECRET"`, `{"bad-name":"SECRET"}`, `{"KEY":null}`, `null`, `["SECRET"]`} {
		t.Setenv("RPC_ENDPOINT_SECRETS", value)
		_, err := config.LoadWorker()
		if err == nil || !strings.Contains(err.Error(), "RPC_ENDPOINT_SECRETS") || strings.Contains(err.Error(), "SECRET\"") {
			t.Fatalf("unsafe secret validation error: %v", err)
		}
	}
}

// D-122: the platform fee plan is 0% when unset, and a plan the contract's tenth can't carry or a minimum over the cap
// stops startup.
func TestPlatformFeePlan(t *testing.T) {
	for _, name := range []string{"DATABASE_URL", "API_ADDR", "PRIVY_APP_ID", "PRIVY_APP_SECRET"} {
		t.Setenv(name, "x")
	}
	t.Setenv("PRIVY_JWKS_URL", "https://jwks")
	t.Setenv("PUBLIC_WEB_URL", "https://forwend.app")
	t.Setenv("RPC_RATE_PER_SECOND", "2")
	for _, c := range []struct{ bps, low, high, want string }{
		{"", "", "", "0 <nil> <nil>"},
		{"50", "0.10", "25", "50 1/10 25/1"},
		{"501", "", "", "invalid"},
		{"50", "1.005", "", "invalid"},
		{"50", "5", "1", "invalid"},
	} {
		t.Setenv("PLATFORM_FEE_BPS", c.bps)
		t.Setenv("PLATFORM_FEE_MIN_USD", c.low)
		t.Setenv("PLATFORM_FEE_CAP_USD", c.high)
		got, err := config.LoadAPI()
		plan := fmt.Sprintf("%d %v %v", got.Fees.RateBps, got.Fees.MinUSD, got.Fees.CapUSD)
		if err != nil {
			plan = "invalid"
		}
		if plan != c.want {
			t.Errorf("bps %q min %q cap %q: %s (%v), want %s", c.bps, c.low, c.high, plan, err, c.want)
		}
	}
}

// D-124: 1Click's pinned key is replaced only for a test's fake on loopback, never by a copied test .env elsewhere.
func TestOneClickSignerKeyOnlyForAFakeOnLoopback(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("RPC_ALLOW_LOOPBACK", "1")
	t.Setenv("RPC_RATE_PER_SECOND", "10")
	t.Setenv("POLL_INTERVAL", "3s")
	t.Setenv("ONECLICK_SIGNER_KEY", "ed25519:test")
	for url, ok := range map[string]bool{"http://127.0.0.1:4100": true, "http://localhost:4100": true,
		"http://[::1]:4100": true, "": false, "https://1click.chaindefuser.com": false, "http://10.0.0.5": false} {
		t.Setenv("ONECLICK_API_URL", url)
		w, err := config.LoadWorker()
		if ok != (err == nil) {
			t.Fatalf("%q: %v", url, err)
		}
		if !ok && !strings.Contains(err.Error(), "ONECLICK_SIGNER_KEY") {
			t.Fatalf("%q: %v", url, err)
		}
		if ok && w.OneClick.Signer != "ed25519:test" {
			t.Fatalf("%q: %+v", url, w.OneClick)
		}
	}
	t.Setenv("ONECLICK_SIGNER_KEY", "")
	t.Setenv("ONECLICK_API_URL", "")
	if w, err := config.LoadWorker(); err != nil || w.OneClick.URL != config.DefaultOneClickURL || w.OneClick.Signer != "" {
		t.Fatalf("default: %+v, %v", w.OneClick, err)
	}
}
