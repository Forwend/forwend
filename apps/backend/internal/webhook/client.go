package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

const AttemptTimeout = 15 * time.Second

// Client refuses private addresses after DNS (so DNS rebinding fails), uses no proxy and fails on a redirect.
func Client() *http.Client {
	dialer := outbound.Dialer(false)
	dialer.Timeout = 10 * time.Second
	return &http.Client{
		Timeout: AttemptTimeout,
		Transport: &http.Transport{DialContext: dialer.DialContext, ForceAttemptHTTP2: true,
			TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: AttemptTimeout, IdleConnTimeout: time.Minute,
			MaxResponseHeaderBytes: 64 << 10},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// sign is the Standard Webhooks signature: one v1 HMAC per secret, so either secret of a rotation verifies.
func sign(secrets []string, id string, timestamp int64, body []byte) string {
	signed := []byte(id + "." + strconv.FormatInt(timestamp, 10) + ".")
	signed = append(signed, body...)
	sigs := make([]string, len(secrets))
	for i, s := range secrets {
		key, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, "whsec_")) // newSecret made it
		mac := hmac.New(sha256.New, key)
		mac.Write(signed)
		sigs[i] = "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	}
	return strings.Join(sigs, " ")
}
