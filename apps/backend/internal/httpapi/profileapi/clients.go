package profileapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// R-86.
func listClients(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := profiles.Clients(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Clients []clientJSON `json:"clients"`
		}{Clients: []clientJSON{}}
		for _, c := range list {
			out.Clients = append(out.Clients, toClientJSON(c))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
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
