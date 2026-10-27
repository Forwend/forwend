package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"github.com/forwend/forwend/apps/backend/internal/outbound"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// AttemptTimeout bounds one attempt, from the dial to the answer's headers.
const AttemptTimeout = 15 * time.Second

var errNotPublic = errors.New("address not public")

// Client sends webhooks. It checks the address it connects to, after DNS, so a name that resolves to a private
// address, or starts to (DNS rebinding), is refused. It uses no proxy and follows no redirect: a 3xx fails.
func Client() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		if addr, err := netip.ParseAddr(host); err != nil || !outbound.PublicAddr(addr) {
			return errNotPublic
		}
		return nil
	}}
	return &http.Client{
		Timeout: AttemptTimeout,
		Transport: &http.Transport{DialContext: dialer.DialContext, ForceAttemptHTTP2: true,
			TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: AttemptTimeout, IdleConnTimeout: time.Minute,
			MaxResponseHeaderBytes: 64 << 10},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// sign is the webhook-signature header (Standard Webhooks): "v1," and the base64 HMAC-SHA256 of id.timestamp.body
// under each secret, space-separated, so a receiver holding either secret of a rotation can check it.
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
