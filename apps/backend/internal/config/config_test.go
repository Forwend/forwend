package config_test

import (
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/config"
)

func TestAPI(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("API_ADDR", ":9")
	t.Setenv("PRIVY_APP_ID", "app")
	t.Setenv("PRIVY_VERIFICATION_KEY", "key")
	got, err := config.LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if got.DatabaseURL != "postgres://x" || got.Addr != ":9" || got.PrivyAppID != "app" || got.PrivyVerificationKey != "key" {
		t.Fatalf("got %+v", got)
	}
}

func TestAPINamesEveryMissingVariable(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("API_ADDR", "")
	t.Setenv("PRIVY_APP_ID", "")
	t.Setenv("PRIVY_VERIFICATION_KEY", "")
	_, err := config.LoadAPI()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL, API_ADDR, PRIVY_APP_ID, PRIVY_VERIFICATION_KEY") {
		t.Fatalf("got %v", err)
	}
}

func TestWorkerNeedsOnlyTheDatabase(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("API_ADDR", "")
	got, err := config.LoadWorker()
	if err != nil || got.DatabaseURL != "postgres://x" {
		t.Fatalf("got %+v, %v", got, err)
	}
	t.Setenv("DATABASE_URL", "")
	if _, err := config.LoadWorker(); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("missing DATABASE_URL: got %v", err)
	}
}
