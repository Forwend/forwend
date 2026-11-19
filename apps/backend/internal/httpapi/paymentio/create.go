package paymentio

import (
	"encoding/json"
	"fmt"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

// Line is one line of a new invoice or checkout session.
type Line struct {
	Description string `json:"description"`
	Quantity    string `json:"quantity"`
	UnitPrice   string `json:"unitPrice"`
}

func Lines(in []Line) []invoice.LineRequest {
	out := make([]invoice.LineRequest, 0, len(in))
	for _, l := range in {
		out = append(out, invoice.LineRequest{Description: l.Description, Quantity: l.Quantity, UnitPrice: l.UnitPrice})
	}
	return out
}

// Metadata reads metadata a body keeps raw, so a value of another shape is invalid_value, as other wrong values are,
// not a malformed body.
func Metadata(raw json.RawMessage) (map[string]string, error) {
	var m map[string]string
	if len(raw) > 0 && json.Unmarshal(raw, &m) != nil {
		return nil, fmt.Errorf("%w: metadata must be an object of text values", invoice.ErrInvalid)
	}
	return m, nil
}
