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

// Routes mounts the invoice endpoints on mux: the owner's create, list and read behind the profile guard; the
// checkout's read, Check status and PDFs in public. balances reads wallet balances from each chain's second RPC
// (D-15); webURL is the web app's origin, for the pay link in PDFs.
func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, balances ledger.BalanceOf, webURL string) {
	rechecks := mid.NewBuckets(RecheckRate, RecheckBurst)
	mux.Handle("POST /v1/profiles/{profileId}/invoices", g.ProfileScoped(createInvoice(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices", g.ProfileScoped(listInvoices(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices/{invoiceId}", g.ProfileScoped(getProfileInvoice(invoices)))
	mux.Handle("GET /v1/invoices/{invoiceId}", getInvoice(invoices)) // checkout reads
	mux.Handle("POST /v1/invoices/{invoiceId}/recheck", recheckInvoice(invoices, balances, rechecks))
	mux.Handle("GET /v1/invoices/{invoiceId}/invoice.pdf", invoicePDF(invoices, webURL))
	mux.Handle("GET /v1/invoices/{invoiceId}/receipt.pdf", receiptPDF(invoices, webURL))
}
