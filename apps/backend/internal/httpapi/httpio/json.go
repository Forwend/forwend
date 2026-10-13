package httpio

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// IdempotencyKey reads the Idempotency-Key header: 1 to 255 bytes of UTF-8.
func IdempotencyKey(r *http.Request) (string, error) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 255 || !utf8.ValidString(key) {
		return "", fmt.Errorf("%w: Idempotency-Key header must be 1 to 255 bytes of UTF-8", ErrMalformed)
	}
	return key, nil
}

// DecodeJSON reads one JSON object of at most 1 MB with no unknown fields.
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
