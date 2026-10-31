package invoice

import (
	"context"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
	"github.com/jackc/pgx/v5"
)

type PaymentAttention struct {
	Invoice  Invoice
	Problems []PaymentProblem
}

type PaymentAttentionPage struct {
	Webhooks          []webhook.EndpointProblem
	WebhooksTruncated bool
	SnapshotAt        time.Time
	Items             []PaymentAttention
	NextCursor        string
}

func paymentAttentionSQL(delay string) string {
	return `EXISTS (SELECT 1 FROM invoices attention WHERE coalesce(attention.main_id,attention.id) = invoices.id AND (
    attention.payment_status = 'partially_paid' AND (SELECT -coalesce(sum(e.amount),0) FROM ledger_transactions l
      JOIN ledger_entries e ON e.transaction_id = l.id WHERE l.invoice_id = attention.id AND e.account = 'recipient_payable') < attention.amount
    OR attention.refund_status IN ('held', 'refund_pending')
    OR ((` + ledger.UnreconciledSQL("attention.id") + `) AND (
      EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id=attention.id AND d.status<>'reorged')
      OR EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id=attention.id)
      OR EXISTS (SELECT 1 FROM invoice_balance_alerts a WHERE a.invoice_id=attention.id)))
    OR EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id = attention.id AND o.policy_exception IS NOT NULL)
    OR EXISTS (SELECT 1 FROM settlement_intents intent WHERE intent.invoice_id = attention.id AND intent.status <> 'confirmed'
      AND (intent.status = 'refused' OR intent.wait IS NOT NULL OR intent.created_at <= transaction_timestamp()-make_interval(secs => ` + delay + `)))
 )) OR EXISTS (SELECT 1 FROM webhook_events event JOIN webhook_deliveries delivery ON delivery.event_id = event.id
    JOIN webhook_endpoints endpoint ON endpoint.id = delivery.endpoint_id WHERE event.invoice_id = invoices.id
    AND (delivery.status = 'failed' OR NOT endpoint.enabled AND delivery.status = 'pending'))`
}

func (s *Service) PaymentAttention(ctx context.Context, profileID string, q PaymentQuery) (PaymentAttentionPage, error) {
	q.Attention = true
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return PaymentAttentionPage{}, err
	}
	defer tx.Rollback(ctx)
	page, err := readPaymentPage(ctx, tx, profileID, q)
	if err != nil {
		return PaymentAttentionPage{}, err
	}
	result := PaymentAttentionPage{Items: make([]PaymentAttention, 0, len(page.Items)), NextCursor: page.NextCursor}
	if err := tx.QueryRow(ctx, "SELECT transaction_timestamp()").Scan(&result.SnapshotAt); err != nil {
		return PaymentAttentionPage{}, err
	}
	options, err := readOperationOptions(ctx, tx, page.Items, true)
	if err != nil {
		return PaymentAttentionPage{}, err
	}
	ids := make([]string, len(page.Items))
	for i := range page.Items {
		ids[i] = page.Items[i].ID
	}
	deliveries, err := webhook.ProblemDeliveries(ctx, tx, ids)
	if err != nil {
		return PaymentAttentionPage{}, err
	}
	for _, inv := range page.Items {
		item := PaymentAttention{Invoice: inv}
		for _, option := range options[inv.ID] {
			item.Problems = append(item.Problems, optionProblems(inv, option, result.SnapshotAt)...)
		}
		if delivery, ok := deliveries[inv.ID]; ok {
			item.Problems = append(item.Problems, PaymentProblem{Code: ProblemWebhookDelivery, Action: ActionReviewWebhooks, EndpointID: delivery.EndpointID, EventID: delivery.EventID})
		}
		result.Items = append(result.Items, item)
	}
	if q.IncludeWebhookOperations {
		endpoints, err := webhook.ProblemEndpoints(ctx, tx, profileID, q.StoreID, q.Livemode, q.Limit)
		if err != nil {
			return PaymentAttentionPage{}, err
		}
		result.WebhooksTruncated = len(endpoints) > q.Limit
		if result.WebhooksTruncated {
			endpoints = endpoints[:q.Limit]
		}
		result.Webhooks = endpoints
	}
	return result, tx.Commit(ctx)
}
