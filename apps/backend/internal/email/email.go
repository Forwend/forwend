// Package email sends transactional email through Resend (D-65). Nothing here logs an address, a subject or a body.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Message is one email: a plain text part, and the designed HTML part when there is one. Key is the Idempotency-Key:
// Resend sends one email per key for 24 hours, so a retry after a lost answer never sends twice. ReplyTo is optional.
type Message struct {
	To, Subject, Text, HTML, Key, ReplyTo string
}

// Sender sends one message; the worker's tests replace it.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// ResendURL is Resend's send endpoint (resend.com/docs/api-reference/emails/send-email).
const ResendURL = "https://api.resend.com/emails"

// Resend sends from From with an API key that may only send.
type Resend struct {
	Key, From, URL string
	Client         *http.Client
}

func NewResend(key, from string) *Resend {
	return &Resend{Key: key, From: from, URL: ResendURL, Client: &http.Client{Timeout: 20 * time.Second}}
}

func (r *Resend) Send(ctx context.Context, m Message) error {
	fields := map[string]any{"from": r.From, "to": []string{m.To}, "subject": m.Subject, "text": m.Text}
	if m.HTML != "" {
		fields["html"] = m.HTML
	}
	if m.ReplyTo != "" {
		fields["reply_to"] = m.ReplyTo
	}
	body, err := json.Marshal(fields)
	if err != nil {
		return fmt.Errorf("encode email: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+r.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", m.Key)
	res, err := r.Client.Do(req)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode/100 != 2 {
		// The status alone: Resend's error text can quote the address.
		return fmt.Errorf("send email: Resend answered %d", res.StatusCode)
	}
	return nil
}
