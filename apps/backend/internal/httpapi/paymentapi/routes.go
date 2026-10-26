package paymentapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, webURL string) {
	mux.Handle("GET /v1/profiles/{profileId}/payments", g.Can(auth.InvoicesRead)(list(invoices, webURL)))
	mux.Handle("GET /v1/profiles/{profileId}/payments/{paymentId}", g.Can(auth.InvoicesRead)(get(invoices, webURL)))
}
