package keyapi

import (
	"fmt"
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/apikey"
	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
)

func listKeys(keys *apikey.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := keys.List(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Keys []keyJSON `json:"keys"`
		}{Keys: []keyJSON{}}
		for _, k := range list {
			out.Keys = append(out.Keys, toKeyJSON(k))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func createKey(keys *apikey.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name    string            `json:"name"`
			StoreID string            `json:"storeId"`
			Scopes  []auth.Permission `json:"scopes"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		k, text, err := keys.Create(r.Context(), r.PathValue("profileId"), mid.SignedInUser(r), body.Name, body.StoreID,
			body.Scopes)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusCreated, createdJSON{toKeyJSON(k), text})
	}
}

func rollKey(keys *apikey.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OverlapHours *int `json:"overlapHours"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		overlap := apikey.DefaultOverlap
		if h := body.OverlapHours; h != nil && (*h < 0 || *h > int(apikey.MaxOverlap/time.Hour)) {
			httpio.WriteError(w, r, fmt.Errorf("%w: overlapHours must be 0 to %d", apikey.ErrInvalid,
				int(apikey.MaxOverlap/time.Hour)))
			return
		} else if h != nil {
			overlap = time.Duration(*h) * time.Hour
		}
		k, text, err := keys.Roll(r.Context(), r.PathValue("profileId"), r.PathValue("keyId"), mid.SignedInUser(r),
			overlap)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusCreated, createdJSON{toKeyJSON(k), text})
	}
}

func revokeKey(keys *apikey.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := keys.Revoke(r.Context(), r.PathValue("profileId"), r.PathValue("keyId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
