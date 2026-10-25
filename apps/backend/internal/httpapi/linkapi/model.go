package linkapi

import (
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
	"github.com/ensp1re/forwend/apps/backend/internal/link"
)

type linkBody struct {
	Title       string     `json:"title"`
	StoreID     string     `json:"storeId"`
	AmountUSD   string     `json:"amountUsd"`
	MinUSD      string     `json:"minUsd"`
	MaxUSD      string     `json:"maxUsd"`
	EndsAt      *time.Time `json:"endsAt"`
	MaxPayments *int       `json:"maxPayments"`
	// Left out: on.
	Active *bool `json:"active"`
}

type linkJSON struct {
	LinkID      string  `json:"linkId"`
	Slug        string  `json:"slug"`
	Title       string  `json:"title"`
	StoreID     *string `json:"storeId"` // null for a freelancer
	AmountUSD   *string `json:"amountUsd"`
	MinUSD      *string `json:"minUsd"`
	MaxUSD      *string `json:"maxUsd"`
	EndsAt      *string `json:"endsAt"`
	MaxPayments *int    `json:"maxPayments"`
	Active      bool    `json:"active"`
	Visits      int64   `json:"visits"`
	Paid        int64   `json:"paid"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

// usd is cents as a decimal with two places; nil for none.
func usd(cents int64) *string {
	if cents == 0 {
		return nil
	}
	s := job.USD(cents)
	return &s
}

func toLinkJSON(l link.Link) linkJSON {
	out := linkJSON{LinkID: l.ID, Slug: l.Slug, Title: l.Title, AmountUSD: usd(l.AmountCents), MinUSD: usd(l.MinCents),
		MaxUSD: usd(l.MaxCents), Active: l.Active, Visits: l.Visits, Paid: l.Paid,
		CreatedAt: l.CreatedAt.UTC().Format(time.RFC3339), UpdatedAt: l.UpdatedAt.UTC().Format(time.RFC3339)}
	if l.StoreID != "" {
		out.StoreID = &l.StoreID
	}
	if l.EndsAt != nil {
		at := l.EndsAt.UTC().Format(time.RFC3339)
		out.EndsAt = &at
	}
	if l.MaxPayments > 0 {
		out.MaxPayments = &l.MaxPayments
	}
	return out
}

// publicLinkJSON is a link as /l/<slug> shows it to its payer (R-142).
type publicLinkJSON struct {
	Slug      string           `json:"slug"`
	Title     string           `json:"title"`
	Payee     *string          `json:"payee"` // the billing name; null before the owner saves billing details
	Brand     *publicBrandJSON `json:"brand"` // a merchant store's (R-135); null for a freelancer
	AmountUSD *string          `json:"amountUsd"`
	MinUSD    *string          `json:"minUsd"`
	MaxUSD    *string          `json:"maxUsd"`
	State     string           `json:"state"`
}

type publicBrandJSON struct {
	StoreID string  `json:"storeId"`
	Color   *string `json:"color"`
	LogoAt  *string `json:"logoAt"`
}

func toPublicLinkJSON(p link.Public) publicLinkJSON {
	out := publicLinkJSON{Slug: p.Slug, Title: p.Title, Payee: httpio.OrNull(p.Payee), AmountUSD: usd(p.AmountCents),
		MinUSD: usd(p.MinCents), MaxUSD: usd(p.MaxCents), State: p.State}
	if p.StoreID != "" {
		out.Brand = &publicBrandJSON{StoreID: p.StoreID, Color: httpio.OrNull(p.BrandColor)}
		if p.LogoAt != nil {
			out.Brand.LogoAt = httpio.OrNullTime(*p.LogoAt)
		}
	}
	return out
}
