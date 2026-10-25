package webhookapi

import (
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/webhook"
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
