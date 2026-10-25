// Package linkapi serves payment links (R-140) of docs/backend/api.md.
package linkapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/link"
)

// A link is an invoice template, so the invoice permissions reach it, for a member's stores alone (D-93).
func Routes(mux *http.ServeMux, g mid.Guards, links *link.Service) {
	mux.Handle("GET /v1/profiles/{profileId}/links", g.Can(auth.InvoicesRead)(listLinks(links)))
	mux.Handle("GET /v1/profiles/{profileId}/links/{linkId}", g.Can(auth.InvoicesRead)(getLink(links)))
	mux.Handle("PUT /v1/profiles/{profileId}/links/{linkId}", g.Can(auth.InvoicesWrite)(putLink(links)))
}
