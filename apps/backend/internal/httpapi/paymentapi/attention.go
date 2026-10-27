package paymentapi

import (
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/paymentio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type attentionItemJSON struct {
	paymentio.Payment
	Problems []problemJSON `json:"problems"`
}

type webhookProblemJSON struct {
	EndpointID      string                `json:"endpointId"`
	StoreID         *string               `json:"storeId"`
	Description     string                `json:"description"`
	Enabled         bool                  `json:"enabled"`
	Livemode        bool                  `json:"livemode"`
	Failed          int64                 `json:"failed"`
	DisabledPending int64                 `json:"disabledPending"`
	LastProblemAt   string                `json:"lastProblemAt"`
	Action          invoice.PaymentAction `json:"action"`
}

func attention(invoices *invoice.Service, webURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query, err := readQuery(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		access := mid.ProfileAccess(r)
		query.IncludeWebhookOperations = access.Can(auth.Webhooks)
		page, err := invoices.PaymentAttention(r.Context(), r.PathValue("profileId"), query)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			SnapshotAt        string               `json:"snapshotAt"`
			Items             []attentionItemJSON  `json:"items"`
			NextCursor        *string              `json:"nextCursor"`
			Webhooks          []webhookProblemJSON `json:"webhooks"`
			WebhooksTruncated bool                 `json:"webhooksTruncated"`
		}{SnapshotAt: page.SnapshotAt.UTC().Format(time.RFC3339Nano), Items: []attentionItemJSON{}, NextCursor: httpio.OrNull(page.NextCursor),
			Webhooks: []webhookProblemJSON{}, WebhooksTruncated: page.WebhooksTruncated}
		for _, item := range page.Items {
			out.Items = append(out.Items, attentionItemJSON{Payment: paymentio.FromInvoice(item.Invoice, webURL), Problems: toProblems(item.Problems, access)})
		}
		for _, endpoint := range page.Webhooks {
			out.Webhooks = append(out.Webhooks, webhookProblemJSON{EndpointID: endpoint.ID, StoreID: httpio.OrNull(endpoint.StoreID), Description: endpoint.Description,
				Enabled: endpoint.Enabled, Livemode: endpoint.Livemode, Failed: endpoint.Failed, DisabledPending: endpoint.DisabledPending,
				LastProblemAt: endpoint.LastProblemAt.UTC().Format(time.RFC3339Nano), Action: invoice.ActionReviewWebhooks})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
