package invoiceapi

import (
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
)

type createInvoiceBody struct {
	ChainID    uint64 `json:"chainId"`
	Token      string `json:"token"`
	Amount     string `json:"amount"`
	AmountUSD  string `json:"amountUsd"`
	ExpiresIn  *int64 `json:"expiresIn"`
	Title      string `json:"title"`
	Note       string `json:"note"`
	DueDate    string `json:"dueDate"`
	SenderName string `json:"senderName"`
	ReturnURL  string `json:"returnUrl"`
	Client     struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Address string `json:"address"`
	} `json:"client"`
}

type invoiceJSON struct {
	InvoiceID        string      `json:"invoiceId"`
	OptionID         string      `json:"optionId"`
	OptionLocked     bool        `json:"optionLocked"`
	OptionCount      int         `json:"optionCount"`
	Confirming       bool        `json:"confirming"`
	Closed           bool        `json:"closed"`
	Number           int64       `json:"number"`
	Title            *string     `json:"title"`
	Note             *string     `json:"note"`
	DueDate          *string     `json:"dueDate"`
	Client           *clientJSON `json:"client,omitempty"` // owner routes only
	Issuer           *issuerJSON `json:"issuer"`
	SenderName       *string     `json:"senderName"`
	ReturnURL        *string     `json:"returnUrl"`
	ChainID          uint64      `json:"chainId"`
	Token            string      `json:"token"`
	Amount           string      `json:"amount"`
	Recipient        string      `json:"recipient"`
	Factory          string      `json:"factory"`
	ReceiveAddress   string      `json:"receiveAddress"`
	ExpiresAt        string      `json:"expiresAt"`
	SettleDeadline   string      `json:"settleDeadline"`
	PaymentStatus    string      `json:"paymentStatus"`
	SettlementStatus string      `json:"settlementStatus"`
	RefundStatus     string      `json:"refundStatus"`
	SettlementTxHash *string     `json:"settlementTxHash"`
	CreatedAt        string      `json:"createdAt"`
}

type clientJSON struct {
	Name    *string `json:"name"`
	Email   *string `json:"email"`
	Address *string `json:"address"`
}

// issuerJSON is billing details as an invoice copied them.
type issuerJSON struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Country string  `json:"country"`
	TaxID   *string `json:"taxId"`
	Email   string  `json:"email"`
}

// invoiceDetailJSON is one invoice read alone: with its deposits and, once reached, the paid and settled times.
type invoiceDetailJSON struct {
	invoiceJSON
	PaidAt    *string `json:"paidAt"`
	SettledAt *string `json:"settledAt"`
	// When the owner canceled it (R-79); null otherwise.
	CanceledAt *string       `json:"canceledAt"`
	Deposits   []depositJSON `json:"deposits"`
	Options    []optionJSON  `json:"options"`
	// When Check status may run again; null when it may now (R-55).
	NextCheckAt *string `json:"nextCheckAt"`
}

// optionJSON is one token and network the invoice accepts, with the terms that differ per option.
type optionJSON struct {
	OptionID       string        `json:"optionId"`
	ChainID        uint64        `json:"chainId"`
	Network        string        `json:"network"`
	Token          string        `json:"token"`
	Symbol         string        `json:"symbol"`
	Decimals       int           `json:"decimals"`
	Amount         string        `json:"amount"`
	ReceiveAddress string        `json:"receiveAddress"`
	Deposits       []depositJSON `json:"deposits"`
}

// ownerInvoiceJSON is an invoice read by its owner: the detail plus why a paid invoice's money has not reached the
// creator yet (null when it is not waiting). The public read leaves it out.
type ownerInvoiceJSON struct {
	invoiceDetailJSON
	SettlementWait *settlementWaitJSON `json:"settlementWait"`
}

type settlementWaitJSON struct {
	Kind        string  `json:"kind"`
	Until       *string `json:"until"`
	SecondsLeft *int64  `json:"secondsLeft"`
}

type invoicesJSON struct {
	Items      []invoiceJSON `json:"items"`
	NextCursor *string       `json:"nextCursor"`
}

type depositJSON struct {
	TxHash      string `json:"txHash"`
	LogIndex    uint64 `json:"logIndex"`
	From        string `json:"from"`
	Amount      string `json:"amount"`
	BlockNumber uint64 `json:"blockNumber"`
	BlockTime   string `json:"blockTime"`
	Status      string `json:"status"`
	Late        bool   `json:"late"`
	BlocksLeft  uint64 `json:"blocksLeft"`
	BlocksTotal uint64 `json:"blocksTotal"`
	SecondsLeft int64  `json:"secondsLeft"`
}

// toInvoiceJSON writes "" as null; withClient is for the owner only.
func toInvoiceJSON(inv invoice.Invoice, withClient bool) invoiceJSON {
	out := invoiceJSON{
		InvoiceID: inv.ID, OptionID: inv.OptionID, OptionLocked: inv.OptionLocked, OptionCount: inv.OptionCount, Confirming: inv.Confirming, Closed: inv.Closed, Number: inv.Number, Title: httpio.OrNull(inv.Title), Note: httpio.OrNull(inv.Note),
		DueDate: httpio.OrNull(inv.DueDate), SenderName: httpio.OrNull(inv.SenderName), ReturnURL: httpio.OrNull(inv.ReturnURL), ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(),
		Recipient: inv.Recipient, Factory: inv.Factory, ReceiveAddress: inv.ReceiveAddress,
		ExpiresAt: inv.ExpiresAt.Format(time.RFC3339), SettleDeadline: inv.SettleDeadline.Format(time.RFC3339),
		PaymentStatus: inv.PaymentStatus, SettlementStatus: inv.SettlementStatus, RefundStatus: inv.RefundStatus,
		SettlementTxHash: httpio.OrNull(inv.SettlementTxHash), CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339),
	}
	if i := inv.Issuer; i != nil {
		out.Issuer = &issuerJSON{Name: i.Name, Address: i.Address, Country: i.Country, TaxID: httpio.OrNull(i.TaxID),
			Email: i.Email}
	}
	if withClient {
		out.Client = &clientJSON{Name: httpio.OrNull(inv.ClientName), Email: httpio.OrNull(inv.ClientEmail),
			Address: httpio.OrNull(inv.ClientAddress)}
	}
	return out
}

func toInvoiceDetailJSON(inv invoice.Invoice, withClient bool) invoiceDetailJSON {
	out := invoiceDetailJSON{invoiceJSON: toInvoiceJSON(inv, withClient), PaidAt: httpio.OrNullTime(inv.PaidAt),
		SettledAt: httpio.OrNullTime(inv.SettledAt), CanceledAt: httpio.OrNullTime(inv.CanceledAt), Deposits: []depositJSON{}, Options: []optionJSON{},
		NextCheckAt: httpio.OrNullTime(inv.NextCheckAt)}
	for _, o := range inv.Options {
		out.Options = append(out.Options, optionJSON{OptionID: o.ID, ChainID: o.ChainID, Network: o.Network,
			Token: o.Token, Symbol: o.Symbol, Decimals: o.Decimals, Amount: o.Amount.String(),
			ReceiveAddress: o.ReceiveAddress, Deposits: toDepositsJSON(o.Deposits)})
	}
	out.Deposits = toDepositsJSON(inv.Deposits)
	return out
}

func toDepositsJSON(deposits []invoice.Deposit) []depositJSON {
	out := []depositJSON{}
	for _, d := range deposits {
		out = append(out, depositJSON{TxHash: d.TxHash, LogIndex: d.LogIndex, From: d.From,
			Amount: d.Amount.String(), BlockNumber: d.BlockNumber, BlockTime: d.BlockTime.Format(time.RFC3339),
			Status: d.Status, Late: d.Late, BlocksLeft: d.BlocksLeft, BlocksTotal: d.BlocksTotal, SecondsLeft: int64(d.TimeLeft / time.Second)})
	}
	return out
}

func toOwnerInvoiceJSON(inv invoice.Invoice) ownerInvoiceJSON {
	out := ownerInvoiceJSON{invoiceDetailJSON: toInvoiceDetailJSON(inv, true)}
	if w := inv.SettlementWait; w != nil {
		out.SettlementWait = &settlementWaitJSON{Kind: w.Kind, Until: httpio.OrNullTime(w.Until)}
		if w.Kind == invoice.WaitFinalizing {
			left := int64(w.TimeLeft / time.Second)
			out.SettlementWait.SecondsLeft = &left
		}
	}
	return out
}

type recheckJSON struct {
	OnChain     string   `json:"onChain"`
	Recorded    string   `json:"recorded"`
	Rescanning  bool     `json:"rescanning"`
	NextCheckAt string   `json:"nextCheckAt"`
	Unreadable  []uint64 `json:"unreadable"`
}
