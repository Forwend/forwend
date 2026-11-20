package webhook

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

func TestSignMatchesStandardWebhooksExample(t *testing.T) {
	got := sign([]string{"whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"}, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330,
		[]byte(`{"test": 2432232314}`))
	if want := "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="; got != want {
		t.Fatalf("signature %q, want %q", got, want)
	}
}

func TestClientRefusesPrivateAddressesAfterDNS(t *testing.T) {
	hit := false
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	defer srv.Close()
	port := srv.URL[strings.LastIndex(srv.URL, ":"):]
	for _, url := range []string{srv.URL, "https://localhost" + port, "https://[::1]" + port} {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, url, nil)
		_, err := Client().Do(req)
		if !errors.Is(err, outbound.ErrNotPublic) || reason(err) != "address not public" {
			t.Errorf("%s: %v, want the address refused", url, err)
		}
	}
	if hit {
		t.Fatal("a refused request reached the server")
	}
}

func TestReasonLeavesOutTheURL(t *testing.T) {
	err := &url.Error{Op: "Post", URL: "https://shop.example.com/hooks?token=receiver-secret",
		Err: errors.New("connection refused")}
	if got := reason(err); got != "connection refused" {
		t.Fatalf("reason %q", got)
	}
}
