package httpio

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

func OrNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func OrNullTime(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	return OrNull(t.Format(time.RFC3339))
}

// Forwend makes invoices under keys with these prefixes in the profile's own key space: a job's payments, a payment
// link's checkouts and a retainer's months. A caller who took such a key first would block that invoice for good.
var reservedKeyPrefixes = []string{"job:", "link:", "retainer:"}

func IdempotencyKey(r *http.Request) (string, error) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 255 || !utf8.ValidString(key) {
		return "", fmt.Errorf("%w: Idempotency-Key header must be 1 to 255 bytes of UTF-8", ErrMalformed)
	}
	for _, prefix := range reservedKeyPrefixes {
		if strings.HasPrefix(key, prefix) {
			return "", fmt.Errorf("%w: Idempotency-Key must not start with %s, which Forwend keeps for itself",
				ErrMalformed, prefix)
		}
	}
	return key, nil
}

func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: one JSON object expected", ErrMalformed)
	}
	return nil
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
