package keyapi

import (
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/apikey"
	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
)

type keyJSON struct {
	KeyID      string            `json:"keyId"`
	Name       string            `json:"name"`
	StoreID    *string           `json:"storeId"` // null for a freelancer's key
	Livemode   bool              `json:"livemode"`
	Last4      string            `json:"last4"`
	Scopes     []auth.Permission `json:"scopes"`
	CreatedAt  string            `json:"createdAt"`
	LastUsedAt *string           `json:"lastUsedAt"`
	ExpiresAt  *string           `json:"expiresAt"` // set once rolled: the key works until then
}

// createdJSON is the one answer that has the key's text.
type createdJSON struct {
	keyJSON
	Secret string `json:"secret"`
}

func toKeyJSON(k apikey.Key) keyJSON {
	out := keyJSON{KeyID: k.ID, Name: k.Name, StoreID: httpio.OrNull(k.StoreID), Livemode: k.Livemode, Last4: k.Last4,
		Scopes: k.Scopes, CreatedAt: k.CreatedAt.UTC().Format(time.RFC3339)}
	if k.LastUsedAt != nil {
		out.LastUsedAt = httpio.OrNullTime(k.LastUsedAt.UTC())
	}
	if k.ExpiresAt != nil {
		out.ExpiresAt = httpio.OrNullTime(k.ExpiresAt.UTC())
	}
	return out
}
