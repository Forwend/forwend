// Package invoiceapi serves the invoice endpoints of docs/backend/api.md.
package invoiceapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
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
	PayerEmailAllRate, PayerEmailAllBurst = 5, 20
)

// A pay page load (R-125) is public too: each link's own budget keeps its count from being run up.
const ViewRate, ViewBurst = 0.2, 5

// balances reads each chain's second RPC (D-15); webURL is the web app's origin, for the pay link in PDFs.
func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, balances ledger.BalanceOf, webURL string) {
	rechecks := mid.NewBuckets(RecheckRate, RecheckBurst)
	owners := mid.NewBuckets(RecheckOwnerRate, RecheckOwnerBurst)
	emails := mid.NewBuckets(PayerEmailAllRate, PayerEmailAllBurst)
	mux.Handle("POST /v1/profiles/{profileId}/invoices", g.ProfileScoped(createInvoice(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices", g.ProfileScoped(listInvoices(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices/{invoiceId}", g.ProfileScoped(getProfileInvoice(invoices)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/cancel", g.ProfileScoped(cancelInvoice(invoices)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/send", g.ProfileScoped(sendInvoice(invoices, emails)))
	mux.Handle("PUT /v1/profiles/{profileId}/invoices/{invoiceId}/reminders", g.ProfileScoped(putReminders(invoices)))
	mux.Handle("PUT /v1/profiles/{profileId}/invoices/{invoiceId}/details", g.ProfileScoped(putDetails(invoices)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/repeat/stop", g.ProfileScoped(stopRepeat(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/events", g.ProfileScoped(listEvents(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/owed", g.ProfileScoped(listOwed(invoices)))
	mux.Handle("GET /v1/invoices/{payToken}", getInvoice(invoices)) // checkout reads
	mux.Handle("POST /v1/invoices/{payToken}/recheck", recheckInvoice(invoices, balances, rechecks, owners))
	perInvoice := func(r *http.Request) string { return r.PathValue("payToken") }
	mux.Handle("PUT /v1/invoices/{payToken}/payer-email",
		mid.Limit(mid.NewBuckets(PayerEmailRate, PayerEmailBurst), perInvoice, putPayerEmail(invoices, emails)))
	mux.Handle("POST /v1/invoices/{payToken}/views", mid.Limit(mid.NewBuckets(ViewRate, ViewBurst), perInvoice,
		countView(invoices)))
	mux.Handle("POST /v1/reminders/{token}/stop", stopReminders(invoices)) // the client's stop link: no sign-in
	mux.Handle("GET /v1/invoices/{payToken}/invoice.pdf", invoicePDF(invoices, webURL))
	mux.Handle("GET /v1/invoices/{payToken}/receipt.pdf", receiptPDF(invoices, webURL))
}
