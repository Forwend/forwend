// Package linkapi serves payment links (R-140) of docs/backend/api.md.
package linkapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/link"
)

// A payer's Pay makes an invoice and watches its receive addresses, so each payer and all links together are limited
// (R-142). A payer is their address behind a trusted proxy: then one stranger's requests can't stop a busy link. With
// no trusted proxy every caller looks alike, so the budget is per link. The shared budget is spent only by a Pay
// that makes an invoice (R-117). A page load counts a visit within its link's own budget.
const (
	PayRate, PayBurst       = 0.1, 5
	PayAllRate, PayAllBurst = 1, 20
	VisitRate, VisitBurst   = 0.2, 5
)

// A link is an invoice template, so the invoice permissions reach it, for a member's stores alone (D-93).
func Routes(mux *http.ServeMux, g mid.Guards, links *link.Service) {
	mux.Handle("GET /v1/profiles/{profileId}/links", g.Can(auth.InvoicesRead)(listLinks(links)))
	mux.Handle("GET /v1/profiles/{profileId}/links/{linkId}", g.Can(auth.InvoicesRead)(getLink(links)))
	mux.Handle("PUT /v1/profiles/{profileId}/links/{linkId}", g.Can(auth.InvoicesWrite)(putLink(links)))
	perLink := func(r *http.Request) string { return r.PathValue("slug") }
	perPayer := func(r *http.Request) string {
		if address := g.Payer(r); address != "" {
			return "payer:" + address
		}
		return "link:" + r.PathValue("slug")
	}
	mux.Handle("GET /v1/links/{slug}", getPublicLink(links))
	mux.Handle("POST /v1/links/{slug}/visits", mid.Limit(mid.NewBuckets(VisitRate, VisitBurst), perLink,
		countVisit(links)))
	mux.Handle("POST /v1/links/{slug}/pay", mid.Limit(mid.NewBuckets(PayRate, PayBurst), perPayer,
		payLink(links, mid.NewBuckets(PayAllRate, PayAllBurst))))
}
