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

// Check status reads a chain RPC per call; the owner's share keeps one account from using up everyone's budget.
const (
	RecheckRate, RecheckBurst           = 1, 10
	RecheckOwnerRate, RecheckOwnerBurst = 0.2, 3
)

// The shared budget, spent only by an email that goes out, keeps the public receipt route from mass mailing.
const (
	PayerEmailRate, PayerEmailBurst       = 0.1, 3
	PickRate, PickBurst                   = 0.2, 10
	PayerEmailAllRate, PayerEmailAllBurst = 5, 20
)

// Each pay link's own budget keeps public page loads from running up its view count.
const ViewRate, ViewBurst = 0.2, 5

func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, profiles *profile.Service,
	balances ledger.BalanceOf, webURL string, hooks *webhook.Service) {
	rechecks := mid.NewBuckets(RecheckRate, RecheckBurst)
	owners := mid.NewBuckets(RecheckOwnerRate, RecheckOwnerBurst)
	emails := mid.NewBuckets(PayerEmailAllRate, PayerEmailAllBurst)
	mux.Handle("POST /v1/profiles/{profileId}/invoices", g.Can(auth.InvoicesWrite)(createInvoice(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices", g.Can(auth.InvoicesRead)(listInvoices(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/fees", g.Can(auth.InvoicesRead)(getFees(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/invoices/{invoiceId}", g.Can(auth.InvoicesRead)(numbered(invoices, getProfileInvoice(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/cancel", g.Can(auth.InvoicesWrite)(numbered(invoices, cancelInvoice(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/reopen", g.Can(auth.InvoicesWrite)(numbered(invoices, reopenInvoice(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/send", g.Can(auth.InvoicesWrite)(numbered(invoices, sendInvoice(invoices, emails))))
	mux.Handle("PUT /v1/profiles/{profileId}/invoices/{invoiceId}/reminders", g.Can(auth.InvoicesWrite)(numbered(invoices, putReminders(invoices))))
	mux.Handle("PUT /v1/profiles/{profileId}/invoices/{invoiceId}/details", g.Can(auth.InvoicesWrite)(numbered(invoices, putDetails(invoices))))
	mux.Handle("POST /v1/profiles/{profileId}/invoices/{invoiceId}/repeat/stop", g.Can(auth.InvoicesWrite)(numbered(invoices, stopRepeat(invoices))))
	mux.Handle("GET /v1/profiles/{profileId}/events", g.Can(auth.InvoicesRead)(listEvents(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/webhook-events",
		g.Can(auth.InvoicesRead)(listWebhookEvents(invoices, hooks)))
	mux.Handle("GET /v1/profiles/{profileId}/owed", g.Can(auth.InvoicesRead)(listOwed(invoices)))
	mux.Handle("GET /v1/invoices/{payToken}", getInvoice(invoices))
	mux.Handle("GET /v1/invoices/{payToken}/embed", embedAllowed(invoices))
	mux.Handle("POST /v1/invoices/{payToken}/recheck", recheckInvoice(invoices, balances, rechecks, owners))
	perInvoice := func(r *http.Request) string { return r.PathValue("payToken") }
	mux.Handle("PUT /v1/invoices/{payToken}/payer-email",
		mid.Limit(mid.NewBuckets(PayerEmailRate, PayerEmailBurst), perInvoice, putPayerEmail(invoices, emails)))
	mux.Handle("PUT /v1/invoices/{payToken}/pick", mid.Limit(mid.NewBuckets(PickRate, PickBurst), perInvoice, putPick(invoices)))
	mux.Handle("GET /v1/invoices/{payToken}/crosschain/tokens",
		mid.Limit(mid.NewBuckets(CrossTokensRate, CrossTokensBurst), perInvoice, getCrossTokens(invoices)))
	// Dry and real quotes spend from their own budgets, so browsing tokens never uses up Show address.
	mux.Handle("GET /v1/invoices/{payToken}/crosschain/price", mid.Limit(mid.NewBuckets(DryQuoteRate, DryQuoteBurst),
		perInvoice, getCrossPrice(invoices, mid.NewBuckets(DryQuoteAllRate, DryQuoteAllBurst))))
	mux.Handle("POST /v1/invoices/{payToken}/crosschain/quotes", mid.Limit(mid.NewBuckets(QuoteRate, QuoteBurst),
		perInvoice, postCrossQuote(invoices, mid.NewBuckets(QuoteAllRate, QuoteAllBurst))))
	mux.Handle("POST /v1/invoices/{payToken}/views", mid.Limit(mid.NewBuckets(ViewRate, ViewBurst), perInvoice,
		countView(invoices)))
	mux.Handle("POST /v1/reminders/{token}/stop", stopReminders(invoices))
	mux.Handle("GET /v1/invoices/{payToken}/invoice.pdf", invoicePDF(invoices, profiles, webURL))
	mux.Handle("GET /v1/invoices/{payToken}/receipt.pdf", receiptPDF(invoices, profiles, webURL))
}
