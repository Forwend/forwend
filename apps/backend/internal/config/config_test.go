package config_test

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/config"
	"github.com/ethereum/go-ethereum/crypto"
)

func TestAPI(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("API_ADDR", ":9")
	t.Setenv("PRIVY_APP_ID", "app")
	t.Setenv("PRIVY_JWKS_URL", "https://jwks")
	t.Setenv("PRIVY_APP_SECRET", "secret")
	t.Setenv("CHAINS_FILE", "chains.json")
	t.Setenv("INFURA_API_KEYS", "a, b,")
	t.Setenv("RPC_RATE_PER_SECOND", "2.5")
	t.Setenv("PUBLIC_WEB_URL", "https://forwend.app/")
	t.Setenv("API_USER_BURST", "")
	got, err := config.LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if got.DatabaseURL != "postgres://x" || got.Addr != ":9" || got.PrivyAppID != "app" || got.PrivyJWKSURL != "https://jwks" ||
		got.PrivyAppSecret != "secret" || got.ChainsFile != "chains.json" || !slices.Equal(got.InfuraKeys, []string{"a", "b"}) ||
		got.RPCRate != 2.5 || got.PublicWebURL != "https://forwend.app" || got.UserBurst != 0 {
		t.Fatalf("got %+v", got)
	}
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
	t.Setenv("CHAINS_FILE", "")
	t.Setenv("INFURA_API_KEYS", "")
	t.Setenv("RPC_RATE_PER_SECOND", "")
	t.Setenv("PUBLIC_WEB_URL", "")
	_, err := config.LoadAPI()
	if err == nil || !strings.Contains(err.Error(),
		"DATABASE_URL, API_ADDR, PRIVY_APP_ID, PRIVY_JWKS_URL, PRIVY_APP_SECRET, CHAINS_FILE, RPC_RATE_PER_SECOND, PUBLIC_WEB_URL") ||
		strings.Contains(err.Error(), "INFURA_API_KEYS") {
		t.Fatalf("got %v", err)
	}
}

func TestWorkerAndSigner(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "") // never a real key in a failure message
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CHAINS_FILE", "chains.json")
	t.Setenv("INFURA_API_KEYS", "a, b,")
	t.Setenv("RPC_RATE_PER_SECOND", "10")
	t.Setenv("POLL_INTERVAL", "3s")
	t.Setenv("EXECUTOR_PRIVATE_KEY", chaintest.Key)
	w, err := config.LoadWorker()
	if err != nil || w.Chains.File != "chains.json" || len(w.Chains.InfuraKeys) != 2 || w.Chains.InfuraKeys[1] != "b" ||
		w.Chains.RPCRate != 10 || w.Chains.PollInterval != 3*time.Second {
		t.Fatalf("worker: %+v, %v", w, err)
	}
	s, err := config.LoadSigner()
	if err != nil || !strings.EqualFold(crypto.PubkeyToAddress(s.ExecutorKey.PublicKey).Hex(), chaintest.Sender) ||
		s.Chains.File != "chains.json" || s.Chains.RPCRate != 10 {
		t.Fatalf("signer: %+v, %v", s.Chains, err)
	}
	t.Setenv("EXECUTOR_PRIVATE_KEY", "0xnot-a-key")
	if _, err := config.LoadSigner(); err == nil ||
		!strings.Contains(err.Error(), "invalid environment variables EXECUTOR_PRIVATE_KEY") || strings.Contains(err.Error(), "not-a-key") {
		t.Fatalf("bad key: got %v", err)
	}

	t.Setenv("INFURA_API_KEYS", "")
	if w, err := config.LoadWorker(); err != nil || len(w.Chains.InfuraKeys) != 0 {
		t.Fatalf("worker without Infura keys: %+v, %v", w, err)
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
	t.Setenv("CANARY_FACTORY", "0xECe745390524e4d0B05D26F56AF7F1D38FDb7546")
	t.Setenv("CANARY_FACTORY_CODE_HASH", "0x"+strings.Repeat("Ab", 32))
	t.Setenv("CANARY_RPC_URLS", `{"84532": ["https://a.example/v3/secret", "https://b.example"]}`)
	t.Setenv("CANARY_PAGE_SCRIPT", "../web/scripts/canary-pay-page.ts")
	got, err := config.LoadCanary()
	if err != nil || got.APIURL != "https://api.forwend.app" || got.WebURL != "https://forwend.app" ||
		got.Factory != "0xece745390524e4d0b05d26f56af7f1d38fdb7546" || got.FactoryCodeHash != "0x"+strings.Repeat("ab", 32) ||
		got.RPCURLs[84532] != [2]string{"https://a.example/v3/secret", "https://b.example"} ||
		got.PageScript != "../web/scripts/canary-pay-page.ts" {
		t.Fatalf("got %+v, %v", got, err)
	}
	// One RPC host twice is not a second opinion; a bad value is named, never shown.
	for _, bad := range []string{`{"84532": ["https://a.example/v3/secret", "https://a.example/v3/other"]}`,
		`{"84532": ["https://a.example/v3/secret"]}`, `{"84532": ["https://a.example/v3/secret", "b.example"]}`, `{}`, "a,b"} {
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
