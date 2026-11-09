package paymentapi

import (
	"bytes"
	"encoding/csv"
	"math/big"
	"net/http"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

var movementCSVHeader = []string{"Recorded at (UTC)", "Record state", "Movement ID", "Payment ID", "Option ID", "Store ID", "Store", "Source", "Live mode", "Document kind", "Invoice number", "Order reference", "Title",
	"Chain ID", "Network", "Token contract", "Token", "Decimals", "Movement kind", "Source amount (base units)", "Booked receiver movement (base units)", "Receiver delta (base units)", "Merchant payable delta (base units)", "Payer held delta (base units)",
	"Receiver USD delta", "Transaction hash", "Event log index", "Token transfer log index", "Block number", "Block hash", "Block time (UTC)", "From", "To", "Source status", "Source verified", "Verified block", "Verified block hash", "Policy exception", "Reconciliation status", "Paid with", "Paid with transaction"}

func exportMovements(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query, err := readMovementQuery(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var body bytes.Buffer
		out := csv.NewWriter(&body)
		out.UseCRLF = true
		if err := out.Write(movementCSVHeader); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		count := 0
		at, err := invoices.ExportPaymentMovements(r.Context(), r.PathValue("profileId"), query, func(movement invoice.PaymentMovement) error {
			count++
			return out.Write(movementCSV(movement))
		})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out.Flush()
		if err := out.Error(); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="payment-movements.csv"`)
		w.Header().Set("X-Forwend-Snapshot-At", at.UTC().Format(time.RFC3339Nano))
		w.Header().Set("X-Forwend-Movement-Count", strconv.Itoa(count))
		_, _ = body.WriteTo(w)
	}
}

func movementCSV(movement invoice.PaymentMovement) []string {
	text := httpio.CSVText
	usd := ""
	if movement.ReceiverDelta != nil && movement.Decimals != nil {
		usd = invoice.PaymentUSDValue(movement.ReceiverDelta, *movement.Decimals)
	}
	number, decimals := "", ""
	if movement.Number != nil {
		number = strconv.FormatInt(*movement.Number, 10)
	}
	if movement.Decimals != nil {
		decimals = strconv.Itoa(*movement.Decimals)
	}
	return []string{text(movement.RecordedAt.UTC().Format(time.RFC3339Nano)), text(movement.State), text(movement.ID), text(movement.PaymentID), text(movement.OptionID), text(movement.StoreID), text(movement.StoreName), text(string(movement.Source)), strconv.FormatBool(movement.Livemode),
		text(string(movement.DocumentKind)), number, text(movement.Reference), text(movement.Title), strconv.FormatUint(movement.ChainID, 10), text(movement.Network), text(movement.Token), text(movement.Symbol), decimals, text(movement.Kind),
		amountCSV(movement.SourceAmount), amountCSV(movement.BookedAmount), amountCSV(movement.ReceiverDelta), amountCSV(movement.PayableDelta), amountCSV(movement.HeldDelta), usd, text(movement.TxHash), uintCSV(movement.LogIndex), uintCSV(movement.TransferLogIndex),
		uintCSV(movement.BlockNumber), text(movement.BlockHash), timeCSV(movement.BlockTime), text(movement.From), text(movement.To), text(movement.Status), strconv.FormatBool(movement.Verified), uintCSV(movement.VerifiedBlock), text(movement.VerifiedHash), text(movement.PolicyException), text(movement.ReconciliationError),
		paidWithCSV(movement.PaidWith), text(paidWithTx(movement.PaidWith))}
}

// paidWithCSV names what the payer sent through NEAR Intents (R-235), as "101.12 USDT on tron through NEAR Intents".
func paidWithCSV(p *invoice.MovementPaidWith) string {
	if p == nil || p.Amount == nil {
		return ""
	}
	return httpio.CSVText(invoice.PaymentUSDValue(p.Amount, p.Decimals) + " " + p.Symbol + " on " + p.Blockchain + " through NEAR Intents")
}

func paidWithTx(p *invoice.MovementPaidWith) string {
	if p == nil {
		return ""
	}
	return p.TxHash
}

func amountCSV(amount *big.Int) string {
	if amount == nil {
		return ""
	}
	return amount.String()
}

func uintCSV(value *uint64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatUint(*value, 10)
}

func timeCSV(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}
