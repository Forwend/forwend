package paymentapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, webURL string) {
	mux.Handle("GET /v1/profiles/{profileId}/payments", g.Can(auth.InvoicesRead)(list(invoices, webURL)))
	mux.Handle("GET /v1/profiles/{profileId}/payments.csv", g.Can(auth.InvoicesRead)(exportMovements(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/{paymentId}/movements.csv", g.Can(auth.InvoicesRead)(exportMovements(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/movements", g.Can(auth.InvoicesRead)(movements(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/{paymentId}/movements", g.Can(auth.InvoicesRead)(movements(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/reconciliation", g.Can(auth.InvoicesRead)(reconciliation(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/{paymentId}/reconciliation", g.Can(auth.InvoicesRead)(reconciliation(invoices)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/attention", g.Can(auth.InvoicesRead)(attention(invoices, webURL)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/{paymentId}", g.Can(auth.InvoicesRead)(get(invoices, webURL)))
}
