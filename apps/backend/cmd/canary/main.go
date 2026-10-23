// Command canary reads open invoices' terms from stdin, one per line, and exits 1 when the api or pay page shows
// a receive address other than the one the factory predicts on two RPCs (R-51).
package main

import (
	"context"
	"flag"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/ensp1re/forwend/apps/backend/internal/canary"
	"github.com/ensp1re/forwend/apps/backend/internal/config"
)

func main() {
	// Empty input usually means the query that lists open invoices failed, so it alerts unless allowed.
	allowEmpty := flag.Bool("allow-empty", false, "pass when stdin lists no invoices")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := config.LoadCanary()
	if err != nil {
		slog.Error("canary stopped", "err", err)
		os.Exit(1)
	}
	in, err := io.ReadAll(os.Stdin)
	if err != nil {
		slog.Error("canary stopped", "err", err)
		os.Exit(1)
	}
	var lines []string
	for line := range strings.Lines(string(in)) {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	alerts := canary.Check(ctx, cfg, lines)
	if len(lines) == 0 && !*allowEmpty {
		alerts = append(alerts, "no invoices on stdin (pass -allow-empty when none are open)")
	}
	for _, a := range alerts {
		slog.Error("canary alert", "problem", a)
	}
	if len(alerts) > 0 {
		os.Exit(1)
	}
	slog.Info("canary passed", "invoices", len(lines))
}
