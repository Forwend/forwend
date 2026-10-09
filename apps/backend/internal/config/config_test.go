package config_test

import (
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/config"
)

func TestAPI(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("API_ADDR", ":9")
	got, err := config.LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if got.DatabaseURL != "postgres://x" || got.Addr != ":9" {
		t.Fatalf("got %+v", got)
	}
}

func TestAPINamesEveryMissingVariable(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("API_ADDR", "")
	_, err := config.LoadAPI()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") || !strings.Contains(err.Error(), "API_ADDR") {
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
