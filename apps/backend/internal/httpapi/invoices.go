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
	ChainID   uint64 `json:"chainId"`
	Token     string `json:"token"`
	Amount    string `json:"amount"`
	ExpiresIn *int64 `json:"expiresIn"`
}

type invoiceJSON struct {
	InvoiceID        string        `json:"invoiceId"`
	ChainID          uint64        `json:"chainId"`
	Token            string        `json:"token"`
	Amount           string        `json:"amount"`
	Recipient        string        `json:"recipient"`
	Factory          string        `json:"factory"`
	ReceiveAddress   string        `json:"receiveAddress"`
	ExpiresAt        string        `json:"expiresAt"`
	SettleDeadline   string        `json:"settleDeadline"`
	PaymentStatus    string        `json:"paymentStatus"`
	SettlementStatus string        `json:"settlementStatus"`
	RefundStatus     string        `json:"refundStatus"`
	CreatedAt        string        `json:"createdAt"`
	Deposits         []depositJSON `json:"deposits"`
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
		})
		if err != nil {
			writeError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, toInvoiceJSON(inv))
	}
}

// getInvoice is GET /v1/invoices/{invoiceId}: public, so checkout can read the terms and recompute the address.
func getInvoice(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, err := invoices.Get(r.Context(), r.PathValue("invoiceId"))
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toInvoiceJSON(inv))
	}
}

func toInvoiceJSON(inv invoice.Invoice) invoiceJSON {
	out := invoiceJSON{
		InvoiceID: inv.ID, ChainID: inv.ChainID, Token: inv.Token, Amount: inv.Amount.String(),
		Recipient: inv.Recipient, Factory: inv.Factory, ReceiveAddress: inv.ReceiveAddress,
		ExpiresAt: inv.ExpiresAt.Format(time.RFC3339), SettleDeadline: inv.SettleDeadline.Format(time.RFC3339),
		PaymentStatus: inv.PaymentStatus, SettlementStatus: inv.SettlementStatus, RefundStatus: inv.RefundStatus,
		CreatedAt: inv.CreatedAt.UTC().Format(time.RFC3339), Deposits: []depositJSON{},
	}
	for _, d := range inv.Deposits {
		out.Deposits = append(out.Deposits, depositJSON{TxHash: d.TxHash, LogIndex: d.LogIndex, Amount: d.Amount.String(),
			BlockNumber: d.BlockNumber, Status: d.Status, Late: d.Late, BlocksLeft: d.BlocksLeft,
			SecondsLeft: int64(d.TimeLeft / time.Second)})
	}
	return out
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
