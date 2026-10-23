//go:build privylive

package privy

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"testing"
	"time"

	privyclient "github.com/privy-io/go-sdk"
	"github.com/privy-io/go-sdk/option"
)

// Against the Privy test app: go test -tags privylive ./internal/privy/ with PRIVY_APP_ID and PRIVY_APP_SECRET set.
func TestLiveProfileWallet(t *testing.T) {
	id, secret := os.Getenv("PRIVY_APP_ID"), os.Getenv("PRIVY_APP_SECRET")
	if id == "" || secret == "" {
		t.Skip("PRIVY_APP_ID and PRIVY_APP_SECRET are not set")
	}
	ctx := context.Background()
	sdk := privyclient.NewPrivyClient(privyclient.PrivyClientOptions{AppID: id, AppSecret: secret})
	u, err := sdk.Users.New(ctx, privyclient.UserNewParams{LinkedAccounts: []privyclient.LinkedAccountInputUnion{
		{OfCustomAuth: &privyclient.LinkedAccountCustomJwtInput{CustomUserID: fmt.Sprintf("forwend-live-%d", time.Now().UnixNano())}}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sdk.Users.Delete(ctx, u.ID) })

	c := NewClient(id, secret, "")
	profileID := fmt.Sprintf("live-%d", time.Now().UnixNano())
	first, err := c.ProfileWallet(ctx, u.ID, profileID)
	if err != nil {
		t.Fatal(err)
	}
	// The SDK's Archive sends no body and Privy answers 415; an explicit {} works (S-1…S-3).
	t.Cleanup(func() {
		_, _ = sdk.Wallets.Archive(ctx, first.ID, option.WithRequestBody("application/json", []byte("{}")))
	})
	if !regexp.MustCompile(`^0x[0-9a-f]{40}$`).MatchString(first.Address) {
		t.Fatalf("address %q is not lowercase hex", first.Address)
	}
	again, err := c.ProfileWallet(ctx, u.ID, profileID)
	if err != nil || again != first {
		t.Fatalf("second call: %+v, %v; want %+v", again, err, first)
	}
}
