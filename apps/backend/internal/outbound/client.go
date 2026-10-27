package outbound

import (
	"errors"
	"net"
	"net/http"
	"net/netip"
	"syscall"
	"time"
)

// Client checks each resolved address immediately before connecting, including after DNS changes.
func Client(allowLoopback bool) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return errors.New("invalid destination")
		}
		addr, err := netip.ParseAddr(host)
		if err != nil || !(PublicAddr(addr) || allowLoopback && addr.IsLoopback()) {
			return errors.New("destination is not public")
		}
		return nil
	}}
	return &http.Client{Transport: &http.Transport{DialContext: dialer.DialContext,
		ForceAttemptHTTP2: true, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 5 * time.Second,
		IdleConnTimeout: time.Minute, MaxIdleConns: 100, MaxIdleConnsPerHost: 100, MaxResponseHeaderBytes: 64 << 10},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
