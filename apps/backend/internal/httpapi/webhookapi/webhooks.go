package webhookapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/webhook"
)

func listEndpoints(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := webhooks.List(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Endpoints []endpointJSON `json:"endpoints"`
		}{Endpoints: []endpointJSON{}}
		for _, e := range list {
			out.Endpoints = append(out.Endpoints, toEndpointJSON(e))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

// PUT to an id the caller picks, so a retried save makes one endpoint (as a link).
func putEndpoint(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body endpointBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		e, created, err := webhooks.Save(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId"),
			webhook.Details{URL: body.URL, Description: body.Description, StoreID: body.StoreID, Events: body.Events,
				Enabled: body.Enabled == nil || *body.Enabled})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toEndpointJSON(e))
	}
}

func deleteEndpoint(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := webhooks.Delete(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func revealSecrets(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := webhooks.Secrets(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toSecretsJSON(list))
	}
}

func rotateSecret(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := webhooks.Rotate(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusCreated, toSecretsJSON(list))
	}
}
