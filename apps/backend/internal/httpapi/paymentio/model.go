// Package paymentio owns the financial JSON shared by checkout and payment reads.
package paymentio

import (
	"encoding/json"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/intents"
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
	Receipts      []Receipt             `json:"receipts"`
	CustomerEmail *string               `json:"customerEmail"`
	CustomerName  *string               `json:"customerName"`
	OptionID      string                `json:"optionId"`
	OptionLocked  bool                  `json:"optionLocked"`
	OptionCount   int                   `json:"optionCount"`
	Symbol        string                `json:"symbol"`
	Decimals      int                   `json:"decimals"`
	Source        invoice.PaymentSource `json:"source"`
	Amounts       *Amounts              `json:"amounts,omitempty"`
	PaymentID     string                `json:"paymentId"`
	Purpose       invoice.Purpose       `json:"purpose"`
	DocumentKind  invoice.DocumentKind  `json:"documentKind"`
	Number        *int64                `json:"number"`
	DueDate       *string               `json:"dueDate"`
	StoreID       *string               `json:"storeId"`
	StoreName     *string               `json:"storeName"`
	LinkID        *string               `json:"linkId"`
	Livemode      bool                  `json:"livemode"`
	Title         *string               `json:"title"`
	Reference     *string               `json:"reference"`
	ChainID       uint64                `json:"chainId"`
	Token         string                `json:"token"`
	Amount        string                `json:"amount"`
	Fees
	PaymentStatus    string  `json:"paymentStatus"`
	SettlementStatus string  `json:"settlementStatus"`
	RefundStatus     string  `json:"refundStatus"`
	State            string  `json:"state"`
	Wallet           string  `json:"wallet"`
	Confirming       bool    `json:"confirming"`
	Closed           bool    `json:"closed"`
	CreatedAt        string  `json:"createdAt"`
	ClosesAt         string  `json:"closesAt"`
	HostedURL        *string `json:"hostedUrl"`
	PayToken         *string `json:"payToken"`
	// R-235: a payment's own read gives its shown quote; a list only one whose deposit pays it (R-239).
	CrossChain *CrossChain `json:"crossChain"`
}

// CrossChain is how a payment through NEAR Intents went (R-235): the quote, 1Click's status, what the payer sent and
// got back, and both chains' transactions. signed is 1Click's answer, which the pay page checks (D-124).
type CrossChain struct {
	Provider       string          `json:"provider"`
	QuoteID        string          `json:"quoteId"`
	AssetID        string          `json:"assetId"`
	Blockchain     string          `json:"blockchain"`
	Symbol         string          `json:"symbol"`
	Decimals       int             `json:"decimals"`
	DepositAddress string          `json:"depositAddress"`
	RefundTo       string          `json:"refundTo"`
	AmountIn       string          `json:"amountIn"`
	MinAmountIn    string          `json:"minAmountIn"`
	AmountOut      string          `json:"amountOut"`
	Status         string          `json:"status"`
	Deposited      *string         `json:"deposited"`
	Delivered      *string         `json:"delivered"`
	Refunded       *string         `json:"refunded"`
	RefundReason   *string         `json:"refundReason"`
	OriginTxs      []intents.Tx    `json:"originTxs"`
	DestinationTxs []intents.Tx    `json:"destinationTxs"`
	ShownUntil     string          `json:"shownUntil"`
	Deadline       string          `json:"deadline"`
	CreatedAt      string          `json:"createdAt"`
	DepositSeenAt  *string         `json:"depositSeenAt"`
	ConvertedAt    *string         `json:"convertedAt"`
	Signed         json.RawMessage `json:"signed"`
}

// FromCrossChain is nil without a quote.
func FromCrossChain(c *invoice.CrossChainPayment) *CrossChain {
	if c == nil {
		return nil
	}
	amount := func(n *big.Int) *string {
		if n == nil {
			return nil
		}
		s := n.String()
		return &s
	}
	at := func(t *time.Time) *string {
		if t == nil {
			return nil
		}
		return httpio.OrNullTime(*t)
	}
	return &CrossChain{Provider: "near_intents", QuoteID: c.QuoteID, AssetID: c.Asset, Blockchain: c.Blockchain,
		Symbol: c.Symbol, Decimals: c.Decimals, DepositAddress: c.DepositAddress, RefundTo: c.RefundTo,
		AmountIn: c.AmountIn.String(), MinAmountIn: c.MinAmountIn.String(), AmountOut: c.AmountOut.String(),
		Status: c.Status, Deposited: amount(c.Deposited), Delivered: amount(c.Delivered), Refunded: amount(c.Refunded),
		RefundReason: httpio.OrNull(c.RefundReason), OriginTxs: c.OriginTxs, DestinationTxs: c.DestinationTxs,
		ShownUntil: c.ShownUntil.Format(time.RFC3339), Deadline: c.Deadline.Format(time.RFC3339),
		CreatedAt: c.CreatedAt.Format(time.RFC3339), DepositSeenAt: at(c.DepositSeenAt), ConvertedAt: at(c.ConvertedAt),
		Signed: c.Signed}
}

func FromInvoice(inv invoice.Invoice, webURL string) Payment {
	p := Payment{CustomerEmail: httpio.OrNull(inv.ClientEmail), CustomerName: httpio.OrNull(inv.ClientName), OptionID: inv.OptionID, OptionLocked: inv.OptionLocked, OptionCount: inv.OptionCount, Symbol: inv.Symbol, Decimals: inv.Decimals, Source: inv.PaymentSource(), Amounts: FromAmounts(inv.Amounts), PaymentID: inv.ID, Purpose: inv.Purpose, DocumentKind: inv.DocumentKind, Number: inv.Number, DueDate: httpio.OrNull(inv.DueDate),
		StoreID: httpio.OrNull(inv.StoreID), StoreName: httpio.OrNull(inv.StoreName), LinkID: httpio.OrNull(inv.LinkID),
		Livemode: inv.Livemode, Title: httpio.OrNull(inv.Title), Reference: httpio.OrNull(inv.Reference),
		ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(), Fees: FromFees(inv.Amount, inv.Fees), PaymentStatus: inv.PaymentStatus,
		SettlementStatus: inv.SettlementStatus, RefundStatus: inv.RefundStatus, State: inv.State, Wallet: inv.Wallet, Confirming: inv.Confirming,
		Closed: inv.Closed, CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339Nano), ClosesAt: inv.ClosesAt.UTC().Format(time.RFC3339),
		CrossChain: FromCrossChain(inv.CrossChain)}
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
