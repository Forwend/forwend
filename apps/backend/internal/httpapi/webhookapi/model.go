package webhookapi

import (
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

type endpointBody struct {
	URL         string   `json:"url"`
	Description string   `json:"description"`
	StoreID     string   `json:"storeId"`
	Events      []string `json:"events"`
	// Left out: on.
	Enabled *bool `json:"enabled"`
}

type endpointJSON struct {
	EndpointID  string   `json:"endpointId"`
	URL         string   `json:"url"`
	Description string   `json:"description"`
	StoreID     *string  `json:"storeId"` // null for all of a merchant's stores, and for a freelancer
	Events      []string `json:"events"`
	Enabled     bool     `json:"enabled"`
	Livemode    bool     `json:"livemode"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

func toEndpointJSON(e webhook.Endpoint) endpointJSON {
	return endpointJSON{EndpointID: e.ID, URL: e.URL, Description: e.Description, StoreID: httpio.OrNull(e.StoreID),
		Events: e.Events, Enabled: e.Enabled, Livemode: e.Livemode, CreatedAt: e.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: e.UpdatedAt.UTC().Format(time.RFC3339)}
}

type secretJSON struct {
	Secret    string  `json:"secret"`
	CreatedAt string  `json:"createdAt"`
	ExpiresAt *string `json:"expiresAt"` // set once rotated: it signs until then
}

// secretsJSON lists the working secrets, newest first.
type secretsJSON struct {
	Secrets []secretJSON `json:"secrets"`
}

func toSecretsJSON(list []webhook.Secret) secretsJSON {
	out := secretsJSON{Secrets: []secretJSON{}}
	for _, s := range list {
		j := secretJSON{Secret: s.Text, CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339)}
		if s.ExpiresAt != nil {
			j.ExpiresAt = httpio.OrNullTime(s.ExpiresAt.UTC())
		}
		out.Secrets = append(out.Secrets, j)
	}
	return out
}

// R-149: nextAttemptAt is null unless pending; statusCode is null when no answer came.
type deliveryJSON struct {
	EventID       string        `json:"eventId"`
	Type          string        `json:"type"`
	InvoiceID     *string       `json:"invoiceId"` // null for a test event
	Number        *int64        `json:"number"`
	Status        string        `json:"status"`
	NextAttemptAt *string       `json:"nextAttemptAt"`
	CreatedAt     string        `json:"createdAt"`
	Attempts      []attemptJSON `json:"attempts"`
}

type attemptJSON struct {
	At         string  `json:"at"`
	StatusCode *int    `json:"statusCode"`
	Error      *string `json:"error"`
	DurationMS int64   `json:"durationMs"`
}

func toDeliveryJSON(d webhook.Delivery) deliveryJSON {
	out := deliveryJSON{EventID: d.EventID, Type: d.Type, InvoiceID: httpio.OrNull(d.InvoiceID), Number: d.Number,
		Status: d.Status, CreatedAt: d.CreatedAt.UTC().Format(time.RFC3339), Attempts: []attemptJSON{}}
	if d.Status == "pending" {
		out.NextAttemptAt = httpio.OrNullTime(d.NextAttemptAt.UTC())
	}
	for _, a := range d.Attempts {
		j := attemptJSON{At: a.At.UTC().Format(time.RFC3339), Error: httpio.OrNull(a.Error),
			DurationMS: a.Duration.Milliseconds()}
		if a.StatusCode != 0 {
			j.StatusCode = &a.StatusCode
		}
		out.Attempts = append(out.Attempts, j)
	}
	return out
}

type resendFailedBody struct {
	Since string `json:"since"`
}
