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
	got, err := config.LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if got.DatabaseURL != "postgres://x" || got.Addr != ":9" || got.PrivyAppID != "app" || got.PrivyJWKSURL != "https://jwks" ||
		got.PrivyAppSecret != "secret" || got.ChainsFile != "chains.json" || !slices.Equal(got.InfuraKeys, []string{"a", "b"}) {
		t.Fatalf("got %+v", got)
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
	_, err := config.LoadAPI()
	if err == nil || !strings.Contains(err.Error(),
		"DATABASE_URL, API_ADDR, PRIVY_APP_ID, PRIVY_JWKS_URL, PRIVY_APP_SECRET, CHAINS_FILE, INFURA_API_KEYS") {
		t.Fatalf("got %v", err)
	}
}

func TestWorkerAndSigner(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CHAINS_FILE", "chains.json")
	t.Setenv("INFURA_API_KEYS", "a, b,")
	t.Setenv("POLL_INTERVAL", "3s")
	t.Setenv("EXECUTOR_PRIVATE_KEY", "key")
	w, err := config.LoadWorker()
	if err != nil || w.Chains.File != "chains.json" || len(w.Chains.InfuraKeys) != 2 || w.Chains.InfuraKeys[1] != "b" ||
		w.Chains.PollInterval != 3*time.Second {
		t.Fatalf("worker: %+v, %v", w, err)
	}
	s, err := config.LoadSigner()
	if err != nil || s.ExecutorKey != "key" || s.Chains.File != "chains.json" {
		t.Fatalf("signer: %+v, %v", s, err)
	}

	t.Setenv("POLL_INTERVAL", "soon")
	t.Setenv("EXECUTOR_PRIVATE_KEY", "")
	_, err = config.LoadSigner()
	if err == nil || !strings.Contains(err.Error(), "EXECUTOR_PRIVATE_KEY") || !strings.Contains(err.Error(), "POLL_INTERVAL") {
		t.Fatalf("missing key and bad interval: got %v", err)
	}
}
