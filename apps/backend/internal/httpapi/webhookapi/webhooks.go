package webhookapi

import (
	"fmt"
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
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
		e, created, err := webhooks.Save(r.Context(), r.PathValue("profileId"), mid.SignedInUser(r), r.PathValue("endpointId"),
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
		list, err := webhooks.Rotate(r.Context(), r.PathValue("profileId"), mid.SignedInUser(r), r.PathValue("endpointId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusCreated, toSecretsJSON(list))
	}
}

func listDeliveries(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := webhooks.Deliveries(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			Deliveries []deliveryJSON `json:"deliveries"`
		}{Deliveries: []deliveryJSON{}}
		for _, d := range list {
			out.Deliveries = append(out.Deliveries, toDeliveryJSON(d))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}

func resendDelivery(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := webhooks.Resend(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId"),
			r.PathValue("eventId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func resendFailed(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body resendFailedBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		since, err := time.Parse(time.RFC3339, body.Since)
		if err != nil {
			httpio.WriteError(w, r, fmt.Errorf("%w: since must be an RFC 3339 time", webhook.ErrInvalid))
			return
		}
		n, err := webhooks.ResendFailed(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId"), since)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, struct {
			Resent int64 `json:"resent"`
		}{n})
	}
}

func sendTest(webhooks *webhook.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := webhooks.SendTest(r.Context(), r.PathValue("profileId"), r.PathValue("endpointId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusCreated, struct {
			EventID string `json:"eventId"`
		}{id})
	}
}
