package profileapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

// R-86.
func listClients(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := httpio.IntQuery(r, "limit", profile.DefaultClientLimit)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		q, err := httpio.SearchQuery(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		page, err := profiles.Clients(r.Context(), r.PathValue("profileId"), r.URL.Query().Get("cursor"), limit, q)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		items := []clientJSON{}
		for _, c := range page.Clients {
			items = append(items, toClientJSON(c))
		}
		httpio.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "nextCursor": httpio.OrNull(page.NextCursor)})
	}
}

func getClient(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := profiles.Client(r.Context(), r.PathValue("profileId"), r.PathValue("clientId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toClientJSON(c))
	}
}

func putClient(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body clientBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		c, created, err := profiles.SaveClient(r.Context(), r.PathValue("profileId"), r.PathValue("clientId"),
			profile.ClientDetails{Name: body.Name, Email: body.Email, Address: body.Address, Country: body.Country,
				TaxID: body.TaxID, Reference: body.Reference, Reminders: body.Reminders})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toClientJSON(c))
	}
}

// Invoices keep their copy of the client's details.
func deleteClient(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := profiles.DeleteClient(r.Context(), r.PathValue("profileId"), r.PathValue("clientId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
