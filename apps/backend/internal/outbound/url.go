package outbound

import (
	"net"
	"net/netip"
	"net/url"
	"strings"
)

func ValidURL(raw string, allowLoopback bool) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || len(raw) > 4096 || strings.ContainsAny(raw, " \t\r\n") {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	loopback := host == "localhost" || net.ParseIP(host).IsLoopback()
	if u.Scheme != "https" && !(u.Scheme == "http" && allowLoopback && loopback) {
		return false
	}
	if loopback {
		return allowLoopback
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return PublicAddr(addr)
	}
	return true // DNS addresses are checked at connection time.
}
