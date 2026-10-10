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
	ExpiresIn  *int64 `json:"expiresIn"`
	Title      string `json:"title"`
	Note       string `json:"note"`
	DueDate    string `json:"dueDate"`
	SenderName string `json:"senderName"`
	Client     struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Address string `json:"address"`
	} `json:"client"`
}

type invoiceJSON struct {
	InvoiceID        string      `json:"invoiceId"`
	Number           int64       `json:"number"`
	Title            *string     `json:"title"`
	Note             *string     `json:"note"`
	DueDate          *string     `json:"dueDate"`
	Client           *clientJSON `json:"client,omitempty"` // owner routes only
	Issuer           *issuerJSON `json:"issuer"`
	SenderName       *string     `json:"senderName"`
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

// invoiceDetailJSON is one invoice read alone: with its deposits.
type invoiceDetailJSON struct {
	invoiceJSON
	Deposits []depositJSON `json:"deposits"`
}

type invoicesJSON struct {
	Items      []invoiceJSON `json:"items"`
	NextCursor *string       `json:"nextCursor"`
}

type depositJSON struct {
	TxHash      string `json:"txHash"`
	LogIndex    uint64 `json:"logIndex"`
	Amount      string `json:"amount"`
	BlockNumber uint64 `json:"blockNumber"`
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
			ChainID: body.ChainID, Token: body.Token, Amount: body.Amount, ExpiresInSeconds: body.ExpiresIn,
			Details: invoice.Details{Title: body.Title, Note: body.Note, DueDate: body.DueDate,
				ClientName: body.Client.Name, ClientEmail: body.Client.Email, ClientAddress: body.Client.Address,
				SenderName: body.SenderName},
		})
		if err != nil {
			writeError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, toInvoiceDetailJSON(inv, true))
	}
}

// listInvoices is GET /v1/profiles/{profileId}/invoices?limit=&cursor=.
func listInvoices(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, err := intQuery(r, "limit", invoice.DefaultLimit)
		if err != nil {
			writeError(w, r, err)
			return
		}
		page, err := invoices.List(r.Context(), r.PathValue("profileId"), r.URL.Query().Get("cursor"), limit)
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

// toInvoiceJSON writes "" as null; withClient is for the owner only.
func toInvoiceJSON(inv invoice.Invoice, withClient bool) invoiceJSON {
	out := invoiceJSON{
		InvoiceID: inv.ID, Number: inv.Number, Title: orNull(inv.Title), Note: orNull(inv.Note),
		DueDate: orNull(inv.DueDate), SenderName: orNull(inv.SenderName), ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(),
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
	out := invoiceDetailJSON{invoiceJSON: toInvoiceJSON(inv, withClient), Deposits: []depositJSON{}}
	for _, d := range inv.Deposits {
		out.Deposits = append(out.Deposits, depositJSON{TxHash: d.TxHash, LogIndex: d.LogIndex, Amount: d.Amount.String(),
			BlockNumber: d.BlockNumber, Status: d.Status, Late: d.Late, BlocksLeft: d.BlocksLeft,
			SecondsLeft: int64(d.TimeLeft / time.Second)})
	}
	return out
}

func orNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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
