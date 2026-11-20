// Package email sends email through Resend; it never logs an address, a subject or a body.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Key is Resend's Idempotency-Key (one email per key for 24 hours); Unsubscribe is an RFC 8058 one-click URL.
type Message struct {
	To, Subject, Text, HTML, Key, ReplyTo, Unsubscribe string
}

type Sender interface {
	Send(ctx context.Context, m Message) error
}

// ErrRefused is a 400 or 422: this message is bad, but the next one may still go.
var ErrRefused = errors.New("Resend refused the message")

const ResendURL = "https://api.resend.com/emails"

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
	if m.Unsubscribe != "" {
		fields["headers"] = map[string]string{"List-Unsubscribe": "<" + m.Unsubscribe + ">",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
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
	switch {
	case res.StatusCode == http.StatusBadRequest, res.StatusCode == http.StatusUnprocessableEntity:
		// The status alone: Resend's error text can quote the address.
		return fmt.Errorf("send email: %w: Resend answered %d", ErrRefused, res.StatusCode)
	case res.StatusCode/100 != 2:
		return fmt.Errorf("send email: Resend answered %d", res.StatusCode)
	}
	return nil
}
