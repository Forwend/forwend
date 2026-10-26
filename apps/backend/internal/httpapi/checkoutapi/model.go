package checkoutapi

import (
	"encoding/json"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/paymentio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type createBody struct {
	StoreID   string          `json:"storeId"`
	AmountUSD string          `json:"amountUsd"`
	Reference string          `json:"reference"`
	Title     string          `json:"title"`
	ExpiresIn *int64          `json:"expiresIn"`
	ReturnURL string          `json:"returnUrl"`
	Metadata  json.RawMessage `json:"metadata"`
	Customer  struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"customer"`
	Items []struct {
		Description string `json:"description"`
		Quantity    string `json:"quantity"`
		UnitPrice   string `json:"unitPrice"`
	} `json:"items"`
}

type sessionJSON struct {
	SessionID string                `json:"sessionId"`
	Status    invoice.CheckoutState `json:"status"`
	Payment   paymentio.Payment     `json:"payment"`
}

func toJSON(inv invoice.Invoice, webURL string) sessionJSON {
	return sessionJSON{SessionID: inv.ID, Status: inv.CheckoutState(), Payment: paymentio.FromInvoice(inv, webURL)}
}
