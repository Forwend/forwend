package tests

import (
	"context"
	"testing"
)

// R-84.
func TestWelcomeEmailOncePerNewAccount(t *testing.T) {
	e := invoiceAPI(t)
	const dave, erin, olga = "did:privy:dave", "did:privy:erin", "did:privy:olga"
	e.wallets.Lock()
	e.wallets.Emails[dave] = "dave@example.com"
	e.wallets.Emails[olga] = "olga@example.com"
	e.wallets.FailUserReads = 1 // dave's first load can't read the address: the welcome waits for it
	e.wallets.Unlock()
	e.exec(t, "INSERT INTO users (privy_user_id) VALUES ($1)", olga) // an account from before welcome emails
	for _, user := range []string{dave, dave, dave, erin, olga} {
		if r := e.call(t, "POST", "/v1/me", user, "", ""); r.status/100 != 2 {
			t.Fatalf("load %s: %d %v", user, r.status, r.body)
		}
	}
	welcomes := func(user string) (n int) {
		t.Helper()
		if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox_events o JOIN users u ON u.id = o.user_id
			WHERE u.privy_user_id = $1 AND o.kind = 'account.welcome'`, user).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	for user, want := range map[string]int{dave: 1, erin: 0, olga: 0} {
		if got := welcomes(user); got != want {
			t.Fatalf("%s: %d welcome emails queued, want %d", user, got, want)
		}
	}
}
