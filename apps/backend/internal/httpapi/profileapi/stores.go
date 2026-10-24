package profileapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// R-134.
func listStores(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := profiles.Stores(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Stores []storeJSON `json:"stores"`
		}{Stores: []storeJSON{}}
		for _, s := range list {
			out.Stores = append(out.Stores, toStoreJSON(s))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func putStore(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body storeBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		s, created, err := profiles.SaveStore(r.Context(), r.PathValue("profileId"), r.PathValue("storeId"),
			profile.StoreDetails{Name: body.Name, DefaultExpiresIn: body.DefaultExpiresIn,
				AllowedOrigins: body.AllowedOrigins})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toStoreJSON(s))
	}
}
