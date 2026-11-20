package linkapi

import (
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/link"
)

type linkBody struct {
	Title       string     `json:"title"`
	StoreID     string     `json:"storeId"`
	AmountUSD   string     `json:"amountUsd"`
	MinUSD      string     `json:"minUsd"`
	MaxUSD      string     `json:"maxUsd"`
	EndsAt      *time.Time `json:"endsAt"`
	MaxPayments *int       `json:"maxPayments"`
	Active      *bool      `json:"active"`     // nil: on
	FeesPaidBy  *string    `json:"feesPaidBy"` // nil: the profile's choice
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
	Livemode    bool    `json:"livemode"`
	FeesPaidBy  *string `json:"feesPaidBy"` // null: the profile's choice
	Visits      int64   `json:"visits"`
	Paid        int64   `json:"paid"`
	Reserved    int64   `json:"reserved"`
	Ready       bool    `json:"ready"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

// usd is cents as a two-place decimal; nil for 0.
func usd(cents int64) *string {
	if cents == 0 {
		return nil
	}
	s := invoice.USD(cents)
	return &s
}

func toLinkJSON(l link.Link) linkJSON {
	out := linkJSON{LinkID: l.ID, Slug: l.Slug, Title: l.Title, AmountUSD: usd(l.AmountCents), MinUSD: usd(l.MinCents),
		MaxUSD: usd(l.MaxCents), Active: l.Active, Visits: l.Visits, Paid: l.Paid, Reserved: l.Reserved, Ready: l.Ready, Livemode: l.Livemode,
		CreatedAt: l.CreatedAt.UTC().Format(time.RFC3339), UpdatedAt: l.UpdatedAt.UTC().Format(time.RFC3339),
		FeesPaidBy: httpio.OrNull(l.FeesPaidBy)}
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

type publicLinkJSON struct {
	Version   string           `json:"version"`
	Slug      string           `json:"slug"`
	Title     string           `json:"title"`
	Payee     *string          `json:"payee"` // null before billing details are saved
	Brand     *publicBrandJSON `json:"brand"`
	AmountUSD *string          `json:"amountUsd"`
	MinUSD    *string          `json:"minUsd"`
	MaxUSD    *string          `json:"maxUsd"`
	State     string           `json:"state"`
	Livemode  bool             `json:"livemode"`
}

type publicBrandJSON struct {
	StoreID string  `json:"storeId"`
	Color   *string `json:"color"`
	LogoAt  *string `json:"logoAt"`
}

func toPublicLinkJSON(p link.Public) publicLinkJSON {
	out := publicLinkJSON{Version: strconv.FormatInt(p.Revision, 10), Slug: p.Slug, Title: p.Title, Payee: httpio.OrNull(p.Payee), AmountUSD: usd(p.AmountCents),
		MinUSD: usd(p.MinCents), MaxUSD: usd(p.MaxCents), State: p.State, Livemode: p.Livemode}
	if p.StoreID != "" {
		out.Brand = &publicBrandJSON{StoreID: p.StoreID, Color: httpio.OrNull(p.BrandColor)}
		if p.LogoAt != nil {
			out.Brand.LogoAt = httpio.OrNullTime(*p.LogoAt)
		}
	}
	return out
}
