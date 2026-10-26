package checkoutapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

func Routes(mux *http.ServeMux, g mid.Guards, invoices *invoice.Service, webURL string) {
	mux.Handle("POST /v1/profiles/{profileId}/checkout-sessions", g.Can(auth.InvoicesWrite)(create(invoices, webURL)))
	mux.Handle("GET /v1/profiles/{profileId}/checkout-sessions", g.Can(auth.InvoicesRead)(list(invoices, webURL)))
	mux.Handle("GET /v1/profiles/{profileId}/checkout-sessions/{sessionId}", g.Can(auth.InvoicesRead)(get(invoices, webURL)))
	mux.Handle("POST /v1/profiles/{profileId}/checkout-sessions/{sessionId}/expire", g.Can(auth.InvoicesWrite)(expire(invoices, webURL)))
}
