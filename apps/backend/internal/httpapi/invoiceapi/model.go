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
	PayToken         *string     `json:"payToken"` // null for an invoice made before D-86
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

type issuerJSON struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Country string  `json:"country"`
	TaxID   *string `json:"taxId"`
	Email   string  `json:"email"`
}

type invoiceDetailJSON struct {
	invoiceJSON
	PaidAt    *string `json:"paidAt"`
	SettledAt *string `json:"settledAt"`
	// R-79.
	CanceledAt *string       `json:"canceledAt"`
	Deposits   []depositJSON `json:"deposits"`
	Options    []optionJSON  `json:"options"`
	// In the base units of the option whose id is the invoice's (R-88); empty without a breakdown.
	Lines []lineJSON `json:"lines"`
	// When Check status may run again; null when it may now (R-55).
	NextCheckAt *string `json:"nextCheckAt"`
}

// R-93: Amount is in the currency's minor units.
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

// Owner reads only; settlementWait is null when the money is not waiting.
type ownerInvoiceJSON struct {
	invoiceDetailJSON
	SettlementWait *settlementWaitJSON `json:"settlementWait"`
	Sends          []sendJSON          `json:"sends"`
	Reminders      remindersJSON       `json:"reminders"`
	Retainer       *retainerJSON       `json:"retainer"`
	History        []historyJSON       `json:"history"`
	Views          viewsJSON           `json:"views"`
}

// R-125: firstAt and lastAt are null before the first load.
type viewsJSON struct {
	Count   int64   `json:"count"`
	FirstAt *string `json:"firstAt"`
	LastAt  *string `json:"lastAt"`
}

// R-124: optionId, amount, txHash and step are null when the row has none.
type historyJSON struct {
	ID       int64   `json:"id"`
	Kind     string  `json:"kind"`
	Actor    string  `json:"actor"`
	At       string  `json:"at"`
	OptionID *string `json:"optionId"`
	Amount   *string `json:"amount"`
	TxHash   *string `json:"txHash"`
	Step     *string `json:"step"`
}

// R-98: nextDueDate and nextOn are null once the retainer ended or stopped.
type retainerJSON struct {
	EndDate     *string `json:"endDate"`
	NextDueDate *string `json:"nextDueDate"`
	NextOn      *string `json:"nextOn"`
	StoppedAt   *string `json:"stoppedAt"`
}

// R-94, R-96: sentAt and failedAt stay null while the email waits.
type sendJSON struct {
	RequestedAt string  `json:"requestedAt"`
	SentAt      *string `json:"sentAt"`
	FailedAt    *string `json:"failedAt"`
}

// R-96.
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
	TxHash      string  `json:"txHash"`
	LogIndex    uint64  `json:"logIndex"`
	From        string  `json:"from"`
	Amount      string  `json:"amount"`
	BlockNumber uint64  `json:"blockNumber"`
	BlockTime   string  `json:"blockTime"`
	Status      string  `json:"status"`
	Late        bool    `json:"late"`
	Paid        *string `json:"paid"` // the part booked to the creator (R-121); null until the ledger books it
	BlocksLeft  uint64  `json:"blocksLeft"`
	BlocksTotal uint64  `json:"blocksTotal"`
	SecondsLeft int64   `json:"secondsLeft"`
}

// withClient is for the owner only.
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
		dj := depositJSON{TxHash: d.TxHash, LogIndex: d.LogIndex, From: d.From,
			Amount: d.Amount.String(), BlockNumber: d.BlockNumber, BlockTime: d.BlockTime.Format(time.RFC3339),
			Status: d.Status, Late: d.Late, BlocksLeft: d.BlocksLeft, BlocksTotal: d.BlocksTotal, SecondsLeft: int64(d.TimeLeft / time.Second)}
		if d.Paid != nil {
			dj.Paid = httpio.OrNull(d.Paid.String())
		}
		out = append(out, dj)
	}
	return out
}

func toOwnerInvoiceJSON(inv invoice.Invoice) ownerInvoiceJSON {
	out := ownerInvoiceJSON{invoiceDetailJSON: toInvoiceDetailJSON(inv, true), Sends: []sendJSON{},
		Reminders: remindersJSON{On: inv.Reminders.On, StoppedAt: httpio.OrNullTime(inv.Reminders.StoppedAt),
			Emails: []reminderJSON{}}, History: []historyJSON{},
		Views: viewsJSON{Count: inv.Views.Count, FirstAt: httpio.OrNullTime(inv.Views.FirstAt),
			LastAt: httpio.OrNullTime(inv.Views.LastAt)}}
	for _, s := range inv.Sends {
		out.Sends = append(out.Sends, toSendJSON(s))
	}
	for _, e := range inv.History {
		out.History = append(out.History, historyJSON{ID: e.ID, Kind: e.Kind, Actor: string(e.Actor),
			At: e.At.UTC().Format(time.RFC3339), OptionID: httpio.OrNull(e.Option), Amount: httpio.OrNull(e.Amount),
			TxHash: httpio.OrNull(e.TxHash), Step: httpio.OrNull(e.Step)})
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

// R-96.
type stoppedJSON struct {
	Number int64   `json:"number"`
	From   *string `json:"from"`
}

type owedListJSON struct {
	Items []owedJSON `json:"items"`
}

// R-95: Amount is what is left to pay, or the held amount for kind held.
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
