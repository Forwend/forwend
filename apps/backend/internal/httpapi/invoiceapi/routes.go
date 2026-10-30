// Package invoiceapi serves the invoice endpoints of docs/backend/api.md.
package invoiceapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

// Check status reads a chain RPC per call, so this bounds those reads per api process (R-55). Each owner's invoices
// take from the owner's share first, so one account can't use up the budget everyone shares.
const (
	RecheckRate, RecheckBurst           = 1, 10
	RecheckOwnerRate, RecheckOwnerBurst = 0.2, 3
)

// The receipt address (R-82) is public: the shared budget, spent only by a receipt that goes out (R-117), keeps it
// from mailing many addresses. Per IP belongs to the edge (Q-8). Send to client (R-94) shares the budget.
const (
	PayerEmailRate, PayerEmailBurst       = 0.1, 3
	PickRate, PickBurst                   = 0.2, 10
	PayerEmailAllRate, PayerEmailAllBurst = 5, 20
)

// A pay page load (R-125) is public too: each link's own budget keeps its count from being run up.
const ViewRate, ViewBurst = 0.2, 5

// balances reads each chain's RPC pool (D-15); webURL is the web app's origin, for the pay link in PDFs.
func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, profiles *profile.Service,
	balances ledger.BalanceOf, webURL string, hooks *webhook.Service) {
	rechecks := mid.NewBuckets(RecheckRate, RecheckBurst)
	owners := mid.NewBuckets(RecheckOwnerRate, RecheckOwnerBurst)
	emails := mid.NewBuckets(PayerEmailAllRate, PayerEmailAllBurst)
	mux.Handle("POST /v1/profiles/{profileId}/invoices", g.Can(auth.InvoicesWrite)(createInvoice(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices", g.Can(auth.InvoicesRead)(listInvoices(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices/{invoiceId}", g.Can(auth.InvoicesRead)(numbered(invoices, getProfileInvoice(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/cancel", g.Can(auth.InvoicesWrite)(numbered(invoices, cancelInvoice(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/reopen", g.Can(auth.InvoicesWrite)(numbered(invoices, reopenInvoice(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/send", g.Can(auth.InvoicesWrite)(numbered(invoices, sendInvoice(invoices, emails))))
	mux.Handle("PUT /v1/profiles/{profileId}/invoices/{invoiceId}/reminders", g.Can(auth.InvoicesWrite)(numbered(invoices, putReminders(invoices))))
	mux.Handle("PUT /v1/profiles/{profileId}/invoices/{invoiceId}/details", g.Can(auth.InvoicesWrite)(numbered(invoices, putDetails(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/repeat/stop", g.Can(auth.InvoicesWrite)(numbered(invoices, stopRepeat(invoices))))
	mux.Handle("GET /v1/profiles/{profileId}/events", g.Can(auth.InvoicesRead)(listEvents(invoices)))
	// R-153: each with the body a webhook would carry now.
	mux.Handle("GET /v1/profiles/{profileId}/webhook-events",
		g.Can(auth.InvoicesRead)(listWebhookEvents(invoices, hooks)))
	mux.Handle("GET /v1/profiles/{profileId}/owed", g.Can(auth.InvoicesRead)(listOwed(invoices)))
	mux.Handle("GET /v1/invoices/{payToken}", getInvoice(invoices)) // checkout reads
	mux.Handle("POST /v1/invoices/{payToken}/recheck", recheckInvoice(invoices, balances, rechecks, owners))
	perInvoice := func(r *http.Request) string { return r.PathValue("payToken") }
	mux.Handle("PUT /v1/invoices/{payToken}/payer-email",
		mid.Limit(mid.NewBuckets(PayerEmailRate, PayerEmailBurst), perInvoice, putPayerEmail(invoices, emails)))
	mux.Handle("PUT /v1/invoices/{payToken}/pick", mid.Limit(mid.NewBuckets(PickRate, PickBurst), perInvoice, putPick(invoices)))
	mux.Handle("POST /v1/invoices/{payToken}/views", mid.Limit(mid.NewBuckets(ViewRate, ViewBurst), perInvoice,
		countView(invoices)))
	mux.Handle("POST /v1/reminders/{token}/stop", stopReminders(invoices)) // the client's stop link: no sign-in
	mux.Handle("GET /v1/invoices/{payToken}/invoice.pdf", invoicePDF(invoices, profiles, webURL))
	mux.Handle("GET /v1/invoices/{payToken}/receipt.pdf", receiptPDF(invoices, profiles, webURL))
}
