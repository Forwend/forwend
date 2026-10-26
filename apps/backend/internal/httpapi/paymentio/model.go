// Package paymentio owns the financial JSON shared by checkout and payment reads.
package paymentio

import (
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type Payment struct {
	PaymentID        string               `json:"paymentId"`
	Purpose          invoice.Purpose      `json:"purpose"`
	DocumentKind     invoice.DocumentKind `json:"documentKind"`
	Number           *int64               `json:"number"`
	StoreID          *string              `json:"storeId"`
	StoreName        *string              `json:"storeName"`
	LinkID           *string              `json:"linkId"`
	Livemode         bool                 `json:"livemode"`
	Title            *string              `json:"title"`
	Reference        *string              `json:"reference"`
	ChainID          uint64               `json:"chainId"`
	Token            string               `json:"token"`
	Amount           string               `json:"amount"`
	PaymentStatus    string               `json:"paymentStatus"`
	SettlementStatus string               `json:"settlementStatus"`
	RefundStatus     string               `json:"refundStatus"`
	Confirming       bool                 `json:"confirming"`
	Closed           bool                 `json:"closed"`
	CreatedAt        string               `json:"createdAt"`
	ClosesAt         string               `json:"closesAt"`
	HostedURL        *string              `json:"hostedUrl"`
}

func FromInvoice(inv invoice.Invoice, webURL string) Payment {
	p := Payment{PaymentID: inv.ID, Purpose: inv.Purpose, DocumentKind: inv.DocumentKind, Number: inv.Number,
		StoreID: httpio.OrNull(inv.StoreID), StoreName: httpio.OrNull(inv.StoreName), LinkID: httpio.OrNull(inv.LinkID),
		Livemode: inv.Livemode, Title: httpio.OrNull(inv.Title), Reference: httpio.OrNull(inv.Reference),
		ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(), PaymentStatus: inv.PaymentStatus,
		SettlementStatus: inv.SettlementStatus, RefundStatus: inv.RefundStatus, Confirming: inv.Confirming,
		Closed: inv.Closed, CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339Nano), ClosesAt: inv.ClosesAt.UTC().Format(time.RFC3339)}
	if inv.PayToken != "" {
		url := webURL + "/pay/" + inv.PayToken
		p.HostedURL = &url
	}
	return p
}
