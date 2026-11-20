package invoiceapi

import (
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/openapi"
)

func TestJSONMatchesTheSpec(t *testing.T) {
	for _, c := range []struct {
		spec, hand any
		answer     bool
		loose      []string
	}{
		{spec: openapi.CreateInvoiceRequest{}, hand: createInvoiceBody{}, answer: false},
		{spec: openapi.Invoice{}, hand: ownerInvoiceJSON{}, answer: true, loose: []string{"client", "metadata", "state", "wallet"}},
		{spec: openapi.PublicInvoice{}, hand: invoiceDetailJSON{}, answer: true, loose: []string{"client", "linkId", "metadata", "state", "store", "wallet"}},
		{spec: openapi.Invoices{}, hand: invoicesJSON{}, answer: true, loose: []string{"items[].client", "items[].metadata", "items[].state", "items[].wallet"}},
		{spec: openapi.ListCrossChainTokens200JSONResponseBody{}, hand: crossTokensJSON{}, answer: true},
		{spec: openapi.CrossChainQuote{}, hand: crossQuoteJSON{}, answer: true},
		{spec: openapi.ListEvents200JSONResponseBody{}, hand: eventsJSON{}, answer: true},
		{spec: openapi.GetFees200JSONResponseBody{}, hand: feesJSON{}, answer: true},
		{spec: openapi.ListOwed200JSONResponseBody{}, hand: owedListJSON{}, answer: true},
		{spec: openapi.RecheckInvoice200JSONResponseBody{}, hand: recheckJSON{}, answer: true},
		{spec: openapi.StopReminders200JSONResponseBody{}, hand: stoppedJSON{}, answer: true},
		{spec: openapi.WebhookEvent{}, hand: webhookEventJSON{}, answer: true, loose: []string{"data.invoice.client", "data.invoice.metadata", "data.invoice.state", "data.invoice.wallet"}},
		{spec: openapi.QuoteCrossChainJSONBody{}, hand: crossQuoteBody{}, answer: false},
		{spec: openapi.SetRemindersJSONBody{}, hand: remindersBody{}, answer: false},
		{spec: openapi.PutPayerEmailJSONBody{}, hand: payerEmailBody{}, answer: false},
		{spec: openapi.PutPickJSONBody{}, hand: pickBody{}, answer: false},
		{spec: openapi.EditInvoiceJSONBody{}, hand: detailsBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
