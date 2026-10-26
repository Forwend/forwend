package linkapi

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/link"
)

func listLinks(links *link.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		access := mid.ProfileAccess(r)
		list, err := links.List(r.Context(), r.PathValue("profileId"), access.Stores, access.Livemode)
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
			MaxUSD: body.MaxUSD, EndsAt: body.EndsAt, MaxPayments: body.MaxPayments, Active: active,
			Livemode: mid.ProfileAccess(r).Livemode})
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

// R-142: no sign-in; anyone with the link may pay.
func getPublicLink(links *link.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := links.Public(r.Context(), r.PathValue("slug"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toPublicLinkJSON(p))
	}
}

func countVisit(links *link.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := links.Visit(r.Context(), r.PathValue("slug")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// payLink answers with the new invoice's pay token; the same Idempotency-Key again answers 200 with the same one.
func payLink(links *link.Service, all *mid.Buckets) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := httpio.IdempotencyKey(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var body struct {
			AmountUSD string `json:"amountUsd"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		allow := func() time.Duration { return all.Wait(mid.Everyone(r)) }
		inv, created, err := links.Pay(r.Context(), r.PathValue("slug"), strings.TrimSpace(body.AmountUSD), key, allow)
		var soon *invoice.TooSoonError
		if errors.As(err, &soon) {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(soon.Wait.Seconds())))))
			httpio.WriteError(w, r, httpio.ErrRateLimited)
			return
		}
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, struct {
			PayToken string `json:"payToken"`
		}{inv.PayToken})
	}
}
