package config_test

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/config"
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
	got, err := config.LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if got.DatabaseURL != "postgres://x" || got.Addr != ":9" || got.PrivyAppID != "app" || got.PrivyJWKSURL != "https://jwks" ||
		got.PrivyAppSecret != "secret" || got.ChainsFile != "chains.json" || !slices.Equal(got.InfuraKeys, []string{"a", "b"}) ||
		got.RPCRate != 2.5 || got.PublicWebURL != "https://forwend.app" {
		t.Fatalf("got %+v", got)
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
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CHAINS_FILE", "chains.json")
	t.Setenv("INFURA_API_KEYS", "a, b,")
	t.Setenv("RPC_RATE_PER_SECOND", "10")
	t.Setenv("POLL_INTERVAL", "3s")
	t.Setenv("EXECUTOR_PRIVATE_KEY", "key")
	w, err := config.LoadWorker()
	if err != nil || w.Chains.File != "chains.json" || len(w.Chains.InfuraKeys) != 2 || w.Chains.InfuraKeys[1] != "b" ||
		w.Chains.RPCRate != 10 || w.Chains.PollInterval != 3*time.Second {
		t.Fatalf("worker: %+v, %v", w, err)
	}
	s, err := config.LoadSigner()
	if err != nil || s.ExecutorKey != "key" || s.Chains.File != "chains.json" || s.Chains.RPCRate != 10 {
		t.Fatalf("signer: %+v, %v", s, err)
	}

	// No Infura keys: public RPCs only.
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
