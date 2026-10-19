// Package invoiceapi serves the invoice endpoints (docs/backend/api.md): routes.go lists them, model.go holds
// their JSON, and each other file one group of handlers.
package invoiceapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

// Check status reads a chain RPC per call: this bounds those reads per api process, whoever asks (R-55). Each invoice
// is also limited to one check every invoice.RecheckEvery, across replicas.
const RecheckRate, RecheckBurst = 1, 10

// The payer's receipt address (R-82) is public like the checkout: a few changes per invoice, and a shared budget for
// everyone, so the endpoint can't send mail to many addresses. Per IP belongs to the edge (Q-8). The owner's Send to
// client (R-94) takes from the same shared budget.
const (
	PayerEmailRate, PayerEmailBurst       = 0.1, 3
	PayerEmailAllRate, PayerEmailAllBurst = 5, 20
)

// Routes mounts the invoice endpoints on mux: the owner's create, list, read, cancel and send behind the profile
// guard; the checkout's read, Check status and PDFs in public. balances reads wallet balances from each chain's second RPC
// (D-15); webURL is the web app's origin, for the pay link in PDFs.
func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, balances ledger.BalanceOf, webURL string) {
	rechecks := mid.NewBuckets(RecheckRate, RecheckBurst)
	emails := mid.NewBuckets(PayerEmailAllRate, PayerEmailAllBurst)
	mux.Handle("POST /v1/profiles/{profileId}/invoices", g.ProfileScoped(createInvoice(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices", g.ProfileScoped(listInvoices(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices/{invoiceId}", g.ProfileScoped(getProfileInvoice(invoices)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/cancel", g.ProfileScoped(cancelInvoice(invoices)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/send", g.ProfileScoped(sendInvoice(invoices, emails)))
	mux.Handle("PUT /v1/profiles/{profileId}/invoices/{invoiceId}/reminders", g.ProfileScoped(putReminders(invoices)))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/repeat/stop", g.ProfileScoped(stopRepeat(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/events", g.ProfileScoped(listEvents(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/owed", g.ProfileScoped(listOwed(invoices)))
	mux.Handle("GET /v1/invoices/{payToken}", getInvoice(invoices)) // checkout reads
	mux.Handle("POST /v1/invoices/{payToken}/recheck", recheckInvoice(invoices, balances, rechecks))
	perInvoice := func(r *http.Request) string { return r.PathValue("payToken") }
	mux.Handle("PUT /v1/invoices/{payToken}/payer-email", mid.Limit(emails,
		mid.Everyone, mid.Limit(mid.NewBuckets(PayerEmailRate, PayerEmailBurst), perInvoice, putPayerEmail(invoices))))
	mux.Handle("POST /v1/reminders/{token}/stop", stopReminders(invoices)) // the client's stop link: no sign-in
	mux.Handle("GET /v1/invoices/{payToken}/invoice.pdf", invoicePDF(invoices, webURL))
	mux.Handle("GET /v1/invoices/{payToken}/receipt.pdf", receiptPDF(invoices, webURL))
}
