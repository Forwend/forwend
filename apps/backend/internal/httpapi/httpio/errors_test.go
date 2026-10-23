package httpio

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteErrorLogsTheRouteNotThePath(t *testing.T) {
	var log bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/jobs/{token}/accept", func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, r, errors.New("database down"))
	})
	token := strings.Repeat("ab", 32)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/jobs/"+token+"/accept", nil))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", w.Code)
	}
	if strings.Contains(log.String(), token) || !strings.Contains(log.String(), "/v1/jobs/{token}/accept") {
		t.Fatalf("log %q", log.String())
	}
}
