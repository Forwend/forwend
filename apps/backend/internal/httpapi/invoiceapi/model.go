package invoiceapi

import (
	"strconv"
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
	SupplyDate string `json:"supplyDate"`
	Reference  string `json:"reference"`
	SenderName string `json:"senderName"`
	ReturnURL  string `json:"returnUrl"`
	Reminders  bool   `json:"reminders"`
	Lines      []struct {
		Description string `json:"description"`
		Quantity    string `json:"quantity"`
		UnitPrice   string `json:"unitPrice"`
	} `json:"lines"`
	AgreedValue *struct {
		Currency string `json:"currency"`
		Amount   string `json:"amount"`
		Date     string `json:"date"`
	} `json:"agreedValue"`
	Repeat *struct {
		EndDate string `json:"endDate"`
	} `json:"repeat"`
	Client struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Address string `json:"address"`
		Country string `json:"country"`
		TaxID   string `json:"taxId"`
	} `json:"client"`
}

type invoiceJSON struct {
	InvoiceID        string      `json:"invoiceId"`
	PayToken         *string     `json:"payToken"` // the pay link's; null for an invoice made before D-86
	OptionID         string      `json:"optionId"`
	OptionLocked     bool        `json:"optionLocked"`
	OptionCount      int         `json:"optionCount"`
	Confirming       bool        `json:"confirming"`
	Closed           bool        `json:"closed"`
	Number           int64       `json:"number"`
	Title            *string     `json:"title"`
	Note             *string     `json:"note"`
	DueDate          *string     `json:"dueDate"`
	SupplyDate       *string     `json:"supplyDate"`
	Reference        *string     `json:"reference"`
	AgreedValue      *agreedJSON `json:"agreedValue"`
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
	Country *string `json:"country"`
	TaxID   *string `json:"taxId"`
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
	// In the base units of the option whose id is the invoice's (R-88); empty without a breakdown.
	Lines []lineJSON `json:"lines"`
	// When Check status may run again; null when it may now (R-55).
	NextCheckAt *string `json:"nextCheckAt"`
}

// agreedJSON is the price agreed with the client in fiat (R-93): Amount in the currency's minor units.
type agreedJSON struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
	Decimals int    `json:"decimals"`
	Date     string `json:"date"`
}

type lineJSON struct {
	Description string `json:"description"`
	Quantity    string `json:"quantity"`
	UnitPrice   string `json:"unitPrice"`
	Amount      string `json:"amount"`
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
// creator yet (null when it is not waiting) and the owner's sends to the client. The public read leaves them out.
type ownerInvoiceJSON struct {
	invoiceDetailJSON
	SettlementWait *settlementWaitJSON `json:"settlementWait"`
	Sends          []sendJSON          `json:"sends"`
	Reminders      remindersJSON       `json:"reminders"`
	Retainer       *retainerJSON       `json:"retainer"`
}

// retainerJSON is the retainer the invoice belongs to (R-98): nextDueDate and nextOn are null once it ended or stopped.
type retainerJSON struct {
	EndDate     *string `json:"endDate"`
	NextDueDate *string `json:"nextDueDate"`
	NextOn      *string `json:"nextOn"`
	StoppedAt   *string `json:"stoppedAt"`
}

// sendJSON is one email to the client (R-94, R-96): sentAt and failedAt stay null while the email waits.
type sendJSON struct {
	RequestedAt string  `json:"requestedAt"`
	SentAt      *string `json:"sentAt"`
	FailedAt    *string `json:"failedAt"`
}

// remindersJSON is the invoice's payment reminders (R-96): stoppedAt is when the client stopped them.
type remindersJSON struct {
	On        bool           `json:"on"`
	StoppedAt *string        `json:"stoppedAt"`
	Emails    []reminderJSON `json:"emails"`
}

type reminderJSON struct {
	Step string `json:"step"`
	sendJSON
}

func toSendJSON(s invoice.Send) sendJSON {
	return sendJSON{RequestedAt: s.RequestedAt.Format(time.RFC3339), SentAt: httpio.OrNullTime(s.SentAt),
		FailedAt: httpio.OrNullTime(s.FailedAt)}
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
		InvoiceID: inv.ID, PayToken: httpio.OrNull(inv.PayToken), OptionID: inv.OptionID, OptionLocked: inv.OptionLocked, OptionCount: inv.OptionCount, Confirming: inv.Confirming, Closed: inv.Closed, Number: inv.Number, Title: httpio.OrNull(inv.Title), Note: httpio.OrNull(inv.Note),
		DueDate: httpio.OrNull(inv.DueDate), SupplyDate: httpio.OrNull(inv.SupplyDate), Reference: httpio.OrNull(inv.Reference), SenderName: httpio.OrNull(inv.SenderName), ReturnURL: httpio.OrNull(inv.ReturnURL), ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(),
		Recipient: inv.Recipient, Factory: inv.Factory, ReceiveAddress: inv.ReceiveAddress,
		ExpiresAt: inv.ExpiresAt.Format(time.RFC3339), SettleDeadline: inv.SettleDeadline.Format(time.RFC3339),
		PaymentStatus: inv.PaymentStatus, SettlementStatus: inv.SettlementStatus, RefundStatus: inv.RefundStatus,
		SettlementTxHash: httpio.OrNull(inv.SettlementTxHash), CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339),
	}
	if a := inv.Agreed; a != nil {
		out.AgreedValue = &agreedJSON{Currency: a.Currency, Amount: strconv.FormatInt(a.Amount, 10),
			Decimals: a.Decimals, Date: a.Date}
	}
	if i := inv.Issuer; i != nil {
		out.Issuer = &issuerJSON{Name: i.Name, Address: i.Address, Country: i.Country, TaxID: httpio.OrNull(i.TaxID),
			Email: i.Email}
	}
	if withClient {
		out.Client = &clientJSON{Name: httpio.OrNull(inv.ClientName), Email: httpio.OrNull(inv.ClientEmail),
			Address: httpio.OrNull(inv.ClientAddress), Country: httpio.OrNull(inv.ClientCountry),
			TaxID: httpio.OrNull(inv.ClientTaxID)}
	}
	return out
}

func toInvoiceDetailJSON(inv invoice.Invoice, withClient bool) invoiceDetailJSON {
	out := invoiceDetailJSON{invoiceJSON: toInvoiceJSON(inv, withClient), PaidAt: httpio.OrNullTime(inv.PaidAt),
		SettledAt: httpio.OrNullTime(inv.SettledAt), CanceledAt: httpio.OrNullTime(inv.CanceledAt), Deposits: []depositJSON{}, Options: []optionJSON{},
		Lines:       []lineJSON{},
		NextCheckAt: httpio.OrNullTime(inv.NextCheckAt)}
	for _, o := range inv.Options {
		out.Options = append(out.Options, optionJSON{OptionID: o.ID, ChainID: o.ChainID, Network: o.Network,
			Token: o.Token, Symbol: o.Symbol, Decimals: o.Decimals, Amount: o.Amount.String(),
			ReceiveAddress: o.ReceiveAddress, Deposits: toDepositsJSON(o.Deposits)})
	}
	for _, l := range inv.Lines {
		out.Lines = append(out.Lines, lineJSON{Description: l.Description, Quantity: l.Quantity,
			UnitPrice: l.UnitPrice.String(), Amount: l.Amount.String()})
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
	out := ownerInvoiceJSON{invoiceDetailJSON: toInvoiceDetailJSON(inv, true), Sends: []sendJSON{},
		Reminders: remindersJSON{On: inv.Reminders.On, StoppedAt: httpio.OrNullTime(inv.Reminders.StoppedAt),
			Emails: []reminderJSON{}}}
	for _, s := range inv.Sends {
		out.Sends = append(out.Sends, toSendJSON(s))
	}
	for _, r := range inv.Reminders.Emails {
		out.Reminders.Emails = append(out.Reminders.Emails, reminderJSON{Step: r.Step, sendJSON: toSendJSON(r)})
	}
	if r := inv.Retainer; r != nil {
		out.Retainer = &retainerJSON{EndDate: httpio.OrNull(r.EndDate), NextDueDate: httpio.OrNull(r.NextDue),
			NextOn: httpio.OrNull(r.NextOn), StoppedAt: httpio.OrNullTime(r.StoppedAt)}
	}
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

// stoppedJSON answers the client's stop link (R-96): which invoice, and who sent it.
type stoppedJSON struct {
	Number int64   `json:"number"`
	From   *string `json:"from"`
}

type owedListJSON struct {
	Items []owedJSON `json:"items"`
}

// owedJSON is one Owed to you row (R-95): amount is what is left to pay, or the held amount for held.
type owedJSON struct {
	Kind        string  `json:"kind"`
	InvoiceID   string  `json:"invoiceId"`
	Number      int64   `json:"number"`
	Title       *string `json:"title"`
	ClientName  *string `json:"clientName"`
	DueDate     *string `json:"dueDate"`
	DaysLate    int     `json:"daysLate"`
	OptionCount int     `json:"optionCount"`
	ChainID     uint64  `json:"chainId"`
	Token       string  `json:"token"`
	Symbol      string  `json:"symbol"`
	Decimals    int     `json:"decimals"`
	Amount      string  `json:"amount"`
}

type eventsJSON struct {
	Items []eventJSON `json:"items"`
}

type eventJSON struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	InvoiceID string `json:"invoiceId"`
	Number    int64  `json:"number"`
	ChainID   uint64 `json:"chainId"`
	Token     string `json:"token"`
	Symbol    string `json:"symbol"`
	Decimals  int    `json:"decimals"`
	Amount    string `json:"amount"`
	At        string `json:"at"`
}
