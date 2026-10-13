package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
)

// errMalformed is a request the server can't parse: 400.
var errMalformed = errors.New("malformed request")

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

// issuerJSON is billing details as an invoice copied them, and the body of the billing-details routes.
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
	PaidAt    *string       `json:"paidAt"`
	SettledAt *string       `json:"settledAt"`
	Deposits  []depositJSON `json:"deposits"`
	Options   []optionJSON  `json:"options"`
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
	SecondsLeft int64  `json:"secondsLeft"`
}

// createInvoice is POST /v1/profiles/{profileId}/invoices: 201 when created, 200 when the same request is repeated.
func createInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := idempotencyKey(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		var body createInvoiceBody
		if err := decodeJSON(w, r, &body); err != nil {
			writeError(w, r, err)
			return
		}
		inv, created, err := invoices.Create(r.Context(), r.PathValue("profileId"), key, invoice.Request{
			ChainID: body.ChainID, Token: body.Token, Amount: body.Amount, AmountUSD: body.AmountUSD,
			ExpiresInSeconds: body.ExpiresIn,
			Details: invoice.Details{Title: body.Title, Note: body.Note, DueDate: body.DueDate,
				ClientName: body.Client.Name, ClientEmail: body.Client.Email, ClientAddress: body.Client.Address,
				SenderName: body.SenderName, ReturnURL: body.ReturnURL},
		})
		if err != nil {
			writeError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, toOwnerInvoiceJSON(inv))
	}
}

// listInvoices is GET /v1/profiles/{profileId}/invoices?limit=&cursor=&status=&q=.
func listInvoices(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := intQuery(r, "limit", invoice.DefaultLimit)
		if err != nil {
			writeError(w, r, err)
			return
		}
		q, err := searchQuery(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		query := r.URL.Query()
		page, err := invoices.List(r.Context(), r.PathValue("profileId"), query.Get("cursor"), limit, query.Get("status"), q)
		if err != nil {
			writeError(w, r, err)
			return
		}
		out := invoicesJSON{Items: []invoiceJSON{}}
		if page.NextCursor != "" {
			out.NextCursor = &page.NextCursor
		}
		for _, inv := range page.Items {
			out.Items = append(out.Items, toInvoiceJSON(inv, true))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// getInvoice is GET /v1/invoices/{invoiceId}: public, so checkout can read the terms and recompute the address. The
// id is the only key, so it leaves out the client's contact details; the issuer is who bills the payer, so it stays.
func getInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Get(r.Context(), r.PathValue("invoiceId"))
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toInvoiceDetailJSON(inv, false))
	}
}

// getProfileInvoice is GET /v1/profiles/{profileId}/invoices/{invoiceId}: the public read with the client's details.
func getProfileInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.GetOfProfile(r.Context(), r.PathValue("profileId"), r.PathValue("invoiceId"))
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toOwnerInvoiceJSON(inv))
	}
}

// toInvoiceJSON writes "" as null; withClient is for the owner only.
func toInvoiceJSON(inv invoice.Invoice, withClient bool) invoiceJSON {
	out := invoiceJSON{
		InvoiceID: inv.ID, OptionID: inv.OptionID, OptionLocked: inv.OptionLocked, OptionCount: inv.OptionCount, Number: inv.Number, Title: orNull(inv.Title), Note: orNull(inv.Note),
		DueDate: orNull(inv.DueDate), SenderName: orNull(inv.SenderName), ReturnURL: orNull(inv.ReturnURL), ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(),
		Recipient: inv.Recipient, Factory: inv.Factory, ReceiveAddress: inv.ReceiveAddress,
		ExpiresAt: inv.ExpiresAt.Format(time.RFC3339), SettleDeadline: inv.SettleDeadline.Format(time.RFC3339),
		PaymentStatus: inv.PaymentStatus, SettlementStatus: inv.SettlementStatus, RefundStatus: inv.RefundStatus,
		SettlementTxHash: orNull(inv.SettlementTxHash), CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339),
	}
	if i := inv.Issuer; i != nil {
		out.Issuer = &issuerJSON{Name: i.Name, Address: i.Address, Country: i.Country, TaxID: orNull(i.TaxID),
			Email: i.Email}
	}
	if withClient {
		out.Client = &clientJSON{Name: orNull(inv.ClientName), Email: orNull(inv.ClientEmail),
			Address: orNull(inv.ClientAddress)}
	}
	return out
}

func toInvoiceDetailJSON(inv invoice.Invoice, withClient bool) invoiceDetailJSON {
	out := invoiceDetailJSON{invoiceJSON: toInvoiceJSON(inv, withClient), PaidAt: orNullTime(inv.PaidAt),
		SettledAt: orNullTime(inv.SettledAt), Deposits: []depositJSON{}, Options: []optionJSON{}}
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
			Status: d.Status, Late: d.Late, BlocksLeft: d.BlocksLeft, SecondsLeft: int64(d.TimeLeft / time.Second)})
	}
	return out
}

func toOwnerInvoiceJSON(inv invoice.Invoice) ownerInvoiceJSON {
	out := ownerInvoiceJSON{invoiceDetailJSON: toInvoiceDetailJSON(inv, true)}
	if w := inv.SettlementWait; w != nil {
		out.SettlementWait = &settlementWaitJSON{Kind: w.Kind, Until: orNullTime(w.Until)}
		if w.Kind == invoice.WaitFinalizing {
			left := int64(w.TimeLeft / time.Second)
			out.SettlementWait.SecondsLeft = &left
		}
	}
	return out
}

func orNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func orNullTime(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	return orNull(t.Format(time.RFC3339))
}

// idempotencyKey reads the Idempotency-Key header: 1 to 255 bytes of UTF-8.
func idempotencyKey(r *http.Request) (string, error) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 255 || !utf8.ValidString(key) {
		return "", fmt.Errorf("%w: Idempotency-Key header must be 1 to 255 bytes of UTF-8", errMalformed)
	}
	return key, nil
}

// decodeJSON reads one JSON object of at most 1 MB with no unknown fields.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%w: %w", errMalformed, err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: one JSON object expected", errMalformed)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
