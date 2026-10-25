package linkapi

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/link"
)

func listLinks(links *link.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := links.List(r.Context(), r.PathValue("profileId"), mid.ProfileAccess(r).Stores)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Links []linkJSON `json:"links"`
		}{Links: []linkJSON{}}
		for _, l := range list {
			out.Links = append(out.Links, toLinkJSON(l))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func getLink(links *link.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		l, err := links.Get(r.Context(), r.PathValue("profileId"), r.PathValue("linkId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toLinkJSON(l))
	}
}

// PUT to an id the browser picks, so a retried save makes one link (as a store).
func putLink(links *link.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body linkBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		// R-138: a Developer or Finance member makes links for their own stores, the first one by default.
		if access := mid.ProfileAccess(r); access.Stores != nil {
			if body.StoreID == "" && len(access.Stores) > 0 {
				body.StoreID = access.Stores[0]
			}
			if !access.InStores(strings.ToLower(body.StoreID)) {
				httpio.WriteError(w, r, fmt.Errorf("%w: storeId must be one of the stores you work with", link.ErrInvalid))
				return
			}
		}
		active := body.Active == nil || *body.Active
		l, created, err := links.Save(r.Context(), r.PathValue("profileId"), r.PathValue("linkId"), link.Details{
			Title: body.Title, StoreID: body.StoreID, AmountUSD: body.AmountUSD, MinUSD: body.MinUSD,
			MaxUSD: body.MaxUSD, EndsAt: body.EndsAt, MaxPayments: body.MaxPayments, Active: active})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toLinkJSON(l))
	}
}
