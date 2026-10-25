package webhook

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"unicode/utf8"
)

// The Standard Webhooks spec's own example, then a rotation's two secrets.
func TestSignMatchesStandardWebhooks(t *testing.T) {
	const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
	got := sign([]string{secret}, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, []byte(`{"test": 2432232314}`))
	if want := "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="; got != want {
		t.Fatalf("signature %q, want %q", got, want)
	}
	two := sign([]string{newSecret(), secret}, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, []byte(`{"test": 2432232314}`))
	if parts := strings.Split(two, " "); len(parts) != 2 || parts[1] != got {
		t.Fatalf("two secrets: %q, want two signatures, the second %q", two, got)
	}
}

// R-148: the address is checked after DNS, so a name for this machine is refused like its address.
func TestClientRefusesPrivateAddressesAfterDNS(t *testing.T) {
	hit := false
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	defer srv.Close()
	port := srv.URL[strings.LastIndex(srv.URL, ":"):]
	for _, url := range []string{srv.URL, "https://localhost" + port, "https://[::1]" + port} {
		req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, url, nil)
		_, err := Client().Do(req)
		if !errors.Is(err, errNotPublic) || reason(err) != "address not public" {
			t.Errorf("%s: %v, want the address refused", url, err)
		}
	}
	if hit {
		t.Fatal("a refused request reached the server")
	}
}

// An attempt's error is kept without the URL: its query may hold the receiver's own token.
func TestReasonLeavesOutTheURL(t *testing.T) {
	err := &url.Error{Op: "Post", URL: "https://shop.example.com/hooks?token=receiver-secret",
		Err: errors.New("connection refused")}
	if got := reason(err); got != "connection refused" {
		t.Fatalf("reason %q", got)
	}
}

// A receiver's long non-ASCII status line must still fit the attempt log, whose column takes only valid UTF-8.
func TestReasonIsValidUTF8(t *testing.T) {
	got := reason(&url.Error{Op: "Post", URL: "https://shop.example.com/", Err: errors.New("malformed HTTP status code " +
		strings.Repeat("é", 200))})
	if !utf8.ValidString(got) || len(got) > 300 || !strings.HasPrefix(got, "malformed HTTP status code é") {
		t.Fatalf("reason %q: %d bytes, valid UTF-8 %v", got, len(got), utf8.ValidString(got))
	}
}

func TestClientFollowsNoRedirect(t *testing.T) {
	client := Client()
	client.Transport = nil // this machine's test server: the redirect rule alone
	followed := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { followed = true }))
	defer target.Close()
	srv := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusTemporaryRedirect))
	defer srv.Close()
	resp, err := client.Post(srv.URL, "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusTemporaryRedirect || followed {
		t.Fatalf("status %d, followed %v; want the 307 itself", resp.StatusCode, followed)
	}
}
