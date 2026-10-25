package webhook

import (
	"fmt"
	"net/netip"
	"net/url"
	"strings"
	"unicode"
)

// Not public beyond netip's own checks: CGNAT, "this network", IETF protocol assignments, benchmarking and the reserved
// block; and IPv6 that carries or reaches an IPv4 address (IPv4-compatible, NAT64, 6to4) and the old site-local block.
// Cloud metadata (169.254.169.254, fd00:ec2::254) is link-local or private.
var notPublic = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/96"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("fec0::/10"),
}

// PublicAddr reports whether a webhook may reach addr: never this machine, a private network or a cloud's metadata.
func PublicAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() || addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsMulticast() ||
		addr.IsUnspecified() {
		return false
	}
	for _, p := range notPublic {
		if p.Contains(addr) {
			return false
		}
	}
	return true
}

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
		if !PublicAddr(addr) {
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
