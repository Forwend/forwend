// Package paymentio owns the financial JSON shared by checkout and payment reads.
package paymentio

import (
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type Receipt struct {
	OptionID string `json:"optionId"`
	ChainID  uint64 `json:"chainId"`
	Token    string `json:"token"`
	Symbol   string `json:"symbol"`
	Decimals int    `json:"decimals"`
	Received string `json:"received"`
	Pending  string `json:"pending"`
	Held     string `json:"held"`
}

type Payment struct {
	Receipts         []Receipt             `json:"receipts"`
	CustomerEmail    *string               `json:"customerEmail"`
	CustomerName     *string               `json:"customerName"`
	OptionID         string                `json:"optionId"`
	OptionLocked     bool                  `json:"optionLocked"`
	OptionCount      int                   `json:"optionCount"`
	Symbol           string                `json:"symbol"`
	Decimals         int                   `json:"decimals"`
	Source           invoice.PaymentSource `json:"source"`
	Amounts          *Amounts              `json:"amounts,omitempty"`
	PaymentID        string                `json:"paymentId"`
	Purpose          invoice.Purpose       `json:"purpose"`
	DocumentKind     invoice.DocumentKind  `json:"documentKind"`
	Number           *int64                `json:"number"`
	DueDate          *string               `json:"dueDate"`
	StoreID          *string               `json:"storeId"`
	StoreName        *string               `json:"storeName"`
	LinkID           *string               `json:"linkId"`
	Livemode         bool                  `json:"livemode"`
	Title            *string               `json:"title"`
	Reference        *string               `json:"reference"`
	ChainID          uint64                `json:"chainId"`
	Token            string                `json:"token"`
	Amount           string                `json:"amount"`
	PaymentStatus    string                `json:"paymentStatus"`
	SettlementStatus string                `json:"settlementStatus"`
	RefundStatus     string                `json:"refundStatus"`
	State            string                `json:"state"`
	Wallet           string                `json:"wallet"`
	Confirming       bool                  `json:"confirming"`
	Closed           bool                  `json:"closed"`
	CreatedAt        string                `json:"createdAt"`
	ClosesAt         string                `json:"closesAt"`
	HostedURL        *string               `json:"hostedUrl"`
	PayToken         *string               `json:"payToken"`
}

func FromInvoice(inv invoice.Invoice, webURL string) Payment {
	p := Payment{CustomerEmail: httpio.OrNull(inv.ClientEmail), CustomerName: httpio.OrNull(inv.ClientName), OptionID: inv.OptionID, OptionLocked: inv.OptionLocked, OptionCount: inv.OptionCount, Symbol: inv.Symbol, Decimals: inv.Decimals, Source: inv.PaymentSource(), Amounts: FromAmounts(inv.Amounts), PaymentID: inv.ID, Purpose: inv.Purpose, DocumentKind: inv.DocumentKind, Number: inv.Number, DueDate: httpio.OrNull(inv.DueDate),
		StoreID: httpio.OrNull(inv.StoreID), StoreName: httpio.OrNull(inv.StoreName), LinkID: httpio.OrNull(inv.LinkID),
		Livemode: inv.Livemode, Title: httpio.OrNull(inv.Title), Reference: httpio.OrNull(inv.Reference),
		ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(), PaymentStatus: inv.PaymentStatus,
		SettlementStatus: inv.SettlementStatus, RefundStatus: inv.RefundStatus, State: inv.State, Wallet: inv.Wallet, Confirming: inv.Confirming,
		Closed: inv.Closed, CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339Nano), ClosesAt: inv.ClosesAt.UTC().Format(time.RFC3339)}
	p.Receipts = []Receipt{}
	for _, r := range inv.Receipts {
		p.Receipts = append(p.Receipts, Receipt{OptionID: r.OptionID, ChainID: r.ChainID, Token: r.Token, Symbol: r.Symbol, Decimals: r.Decimals, Received: r.Received.String(), Pending: r.Pending.String(), Held: r.Held.String()})
	}
	if inv.PayToken != "" {
		url := webURL + "/pay/" + inv.PayToken
		p.HostedURL = &url
		p.PayToken = &inv.PayToken
	}
	return p
}
