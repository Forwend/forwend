// Command webhooks sends the webhook deliveries (R-148). It holds no signer, Privy or email key: only the database
// and WEBHOOK_SECRET_KEY, which opens the signing secrets. Its calls go out through webhook.Client's address filter.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

// poll is how often due deliveries are looked for: the first retry comes 5 seconds after a failure.
const poll = time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("webhooks stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadWebhooks()
	if err != nil {
		return err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.CheckSchema(ctx, pool); err != nil {
		return err
	}
	invoices := invoice.NewService(pool)
	body := func(ctx context.Context, e webhook.Event) ([]byte, error) {
		inv, err := invoices.GetOfProfile(ctx, e.ProfileID, e.InvoiceID)
		if err != nil {
			return nil, err
		}
		return invoiceapi.EventBody(e, inv)
	}
	hooks, client := webhook.NewService(pool, cfg.WebhookKey), webhook.Client()
	// Without the key no endpoint can be made, so nothing waits.
	slog.Info("webhooks ready", "on", cfg.WebhookKey != nil)
	for {
		if err := hooks.Deliver(ctx, client, body); err != nil && ctx.Err() == nil {
			slog.Error("deliver webhooks", "err", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(poll):
		}
	}
}
