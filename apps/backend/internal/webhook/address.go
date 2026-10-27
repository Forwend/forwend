package webhook

import (
	"fmt"
	"github.com/forwend/forwend/apps/backend/internal/outbound"
	"net/netip"
	"net/url"
	"strings"
	"unicode"
)

// checkURL takes an https URL with a host and no credentials. A host that is an address must be public; a name is
// left to the delivery, which checks its addresses after DNS (PLAN 11.5).
func checkURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || !strings.HasPrefix(raw, "https://") || u.Hostname() == "" || u.User != nil || u.Fragment != "" ||
		len(raw) > 2048 || strings.ContainsAny(raw, " \t\n") {
		return fmt.Errorf("%w: url must be an https URL of at most 2048 characters, with no credentials", ErrInvalid)
	}
	notPublicHost := fmt.Errorf("%w: url must name a public host", ErrInvalid)
	host := strings.ToLower(u.Hostname())
	if addr, err := netip.ParseAddr(host); err == nil {
		if !outbound.PublicAddr(addr) {
			return notPublicHost
		}
		return nil
	}
	host = strings.TrimSuffix(host, ".")
	last := host[strings.LastIndex(host, ".")+1:]
	switch {
	case strings.ContainsFunc(host, func(r rune) bool { return r > unicode.MaxASCII }):
		return fmt.Errorf("%w: url's host must be ASCII: write a name in its punycode (xn--) form", ErrInvalid)
	// Resolvers read 2130706433, 127.1 and 0x7f000001 as 127.0.0.1: no real name ends in a number.
	case strings.Trim(last, "0123456789") == "" || strings.HasPrefix(last, "0x"),
		host == "localhost", strings.HasSuffix(host, ".localhost"), strings.HasSuffix(host, ".internal"),
		strings.HasSuffix(host, ".local"):
		return notPublicHost
	}
	return nil
}
