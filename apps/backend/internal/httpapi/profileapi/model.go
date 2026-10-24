package profileapi

import (
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

type createProfileBody struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type profileJSON struct {
	ProfileID     string  `json:"profileId"`
	Kind          string  `json:"kind"`
	Name          *string `json:"name"`
	WalletAddress *string `json:"walletAddress"`
	CreatedAt     string  `json:"createdAt"`
}

type meJSON struct {
	OnboardedAt *string       `json:"onboardedAt"`
	Profiles    []profileJSON `json:"profiles"`
}

type onboardingBody struct {
	Choices []string `json:"choices"`
}

type billingDetailsBody struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Country string `json:"country"`
	TaxID   string `json:"taxId"`
	Email   string `json:"email"`
}

type billingDetailsJSON struct {
	Name      string  `json:"name"`
	Address   string  `json:"address"`
	Country   string  `json:"country"`
	TaxID     *string `json:"taxId"`
	Email     string  `json:"email"`
	UpdatedAt string  `json:"updatedAt"`
}

func toBillingDetailsJSON(d profile.BillingDetails) billingDetailsJSON {
	return billingDetailsJSON{
		Name: d.Name, Address: d.Address, Country: d.Country, TaxID: httpio.OrNull(d.TaxID), Email: d.Email,
		UpdatedAt: d.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// R-86: an empty field means none.
type clientBody struct {
	Name      string `json:"name"`
	Email     string `json:"email"`
	Address   string `json:"address"`
	Country   string `json:"country"`
	TaxID     string `json:"taxId"`
	Reference string `json:"reference"`
	Reminders bool   `json:"reminders"`
}

type clientJSON struct {
	ClientID  string  `json:"clientId"`
	Name      string  `json:"name"`
	Email     *string `json:"email"`
	Address   *string `json:"address"`
	Country   *string `json:"country"`
	TaxID     *string `json:"taxId"`
	Reference *string `json:"reference"`
	Reminders bool    `json:"reminders"`
	UpdatedAt string  `json:"updatedAt"`
}

func toClientJSON(c profile.Client) clientJSON {
	return clientJSON{
		ClientID: c.ID, Name: c.Name, Email: httpio.OrNull(c.Email), Address: httpio.OrNull(c.Address),
		Country: httpio.OrNull(c.Country), TaxID: httpio.OrNull(c.TaxID), Reference: httpio.OrNull(c.Reference), Reminders: c.Reminders, UpdatedAt: c.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// R-134.
type storeBody struct {
	Name             string   `json:"name"`
	DefaultExpiresIn int64    `json:"defaultExpiresIn"`
	AllowedOrigins   []string `json:"allowedOrigins"`
}

type storeJSON struct {
	StoreID          string   `json:"storeId"`
	Name             string   `json:"name"`
	DefaultExpiresIn int64    `json:"defaultExpiresIn"`
	AllowedOrigins   []string `json:"allowedOrigins"`
	UpdatedAt        string   `json:"updatedAt"`
}

func toStoreJSON(s profile.Store) storeJSON {
	return storeJSON{StoreID: s.ID, Name: s.Name, DefaultExpiresIn: s.DefaultExpiresIn,
		AllowedOrigins: s.AllowedOrigins, UpdatedAt: s.UpdatedAt.UTC().Format(time.RFC3339)}
}

func toMeJSON(list []profile.Profile, onboardedAt *time.Time) meJSON {
	out := meJSON{Profiles: []profileJSON{}}
	if onboardedAt != nil {
		at := onboardedAt.UTC().Format(time.RFC3339)
		out.OnboardedAt = &at
	}
	for _, p := range list {
		out.Profiles = append(out.Profiles, toProfileJSON(p))
	}
	return out
}

func toProfileJSON(p profile.Profile) profileJSON {
	out := profileJSON{ProfileID: p.ID, Kind: p.Kind, CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339)}
	if p.Name != "" {
		out.Name = &p.Name
	}
	if p.WalletAddress != "" {
		out.WalletAddress = &p.WalletAddress
	}
	return out
}

type notificationsBody struct {
	Email *bool `json:"email"`
}

type notificationsJSON struct {
	Email   bool    `json:"email"`
	Address *string `json:"address"` // null: the account has no login email (or it was not read yet)
}

func toNotificationsJSON(n profile.Notifications) notificationsJSON {
	return notificationsJSON{Email: n.Email, Address: httpio.OrNull(n.Address)}
}
