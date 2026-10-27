package outbound

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
)

func TestResolvedPrivateAddressesAreBlocked(t *testing.T) {
	var calls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); _, _ = io.WriteString(w, "ok") }))
	defer target.Close()
	client := Client(false)
	defer client.CloseIdleConnections()
	if _, err := client.Get(target.URL); err == nil {
		t.Fatal("loopback accepted without opt-in")
	}
	if calls.Load() != 0 {
		t.Fatal("private destination received request")
	}
	local := Client(true)
	defer local.CloseIdleConnections()
	res, err := local.Get(target.URL)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if calls.Load() != 1 {
		t.Fatal("explicit local development request failed")
	}
	for _, address := range []string{"127.0.0.1", "::1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "fd00:ec2::254", "100.64.0.1", "0.0.0.1", "240.0.0.1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::"} {
		if PublicAddr(netip.MustParseAddr(address)) {
			t.Fatalf("nonpublic address %s accepted", address)
		}
	}
	if !PublicAddr(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("public address rejected")
	}
}
