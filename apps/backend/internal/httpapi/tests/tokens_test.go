package tests

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/chain"
)

const arbUSDC = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d"

func TestTokenSavePreservesUnavailablePreferences(t *testing.T) {
	for _, table := range []string{"chains", "tokens"} {
		t.Run(table, func(t *testing.T) {
			e := invoiceAPI(t)
			e.enableArbUSDC(t)
			const owner = "did:privy:alice"
			path := "/v1/profiles/" + e.aliceProfile + "/tokens"
			if r := e.call(t, "PUT", path, owner, "", `{"off":[{"chainId":421614,"token":"`+arbUSDC+`"}]}`); r.status != http.StatusOK {
				t.Fatalf("disable token: %d %v", r.status, r.body)
			}
			e.exec(t, "UPDATE "+table+" SET enabled=false WHERE chain_id=421614")
			if r := e.call(t, "PUT", path, owner, "", `{"off":[]}`); r.status != http.StatusOK {
				t.Fatalf("save visible preferences: %d %v", r.status, r.body)
			}
			e.exec(t, "UPDATE "+table+" SET enabled=true WHERE chain_id=421614")
			body := `{"chainId":421614,"token":"` + arbUSDC + `","amount":"1000000"}`
			if r := e.post(t, owner, e.aliceProfile, "still-off", body); r.status != http.StatusUnprocessableEntity {
				t.Fatalf("hidden preference was lost: %d %v", r.status, r.body)
			}
			if r := e.call(t, "PUT", path, owner, "", `{"off":[]}`); r.status != http.StatusOK {
				t.Fatalf("enable available token: %d %v", r.status, r.body)
			}
			if r := e.post(t, owner, e.aliceProfile, "now-on", body); r.status != http.StatusCreated {
				t.Fatalf("invoice after enabling token: %d %v", r.status, r.body)
			}
		})
	}
}

// enableArbUSDC turns on a second token: Arbitrum Sepolia USDC comes switched off (migration 00015), and the worker
// would add the cursor.
func (e invoiceEnv) enableArbUSDC(t *testing.T) {
	t.Helper()
	e.exec(t, `
		WITH c AS (UPDATE chains SET enabled = true WHERE chain_id = 421614 RETURNING chain_id),
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block)
		             SELECT chain_id, 0, 0 FROM c)
		UPDATE tokens SET enabled = true WHERE chain_id = 421614 AND contract = $1`, arbUSDC)
}

// R-136.
func TestTokensOff(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	e.enableArbUSDC(t)
	path := "/v1/profiles/" + e.aliceProfile + "/tokens"
	on := func(r reply) map[string]bool {
		out := map[string]bool{}
		list, _ := r.body["tokens"].([]any)
		for _, item := range list {
			tok := item.(map[string]any)
			out[tok["token"].(string)] = tok["on"].(bool)
		}
		return out
	}
	if r := e.call(t, "GET", path, alice, "", ""); r.status != http.StatusOK ||
		!reflect.DeepEqual(on(r), map[string]bool{usdc: true, arbUSDC: true}) {
		t.Fatalf("GET before any is off: %d %v", r.status, r.body)
	}
	earlier := e.post(t, alice, e.aliceProfile, "key-0", `{"amountUsd": "5"}`)
	if earlier.status != http.StatusCreated {
		t.Fatalf("an invoice before: %d %v", earlier.status, earlier.body)
	}
	if r := e.call(t, "PUT", path, alice, "", `{"off": [{"chainId": 421614, "token": "0x75FAF114EAFB1BDBE2F0316DF893FD58CE46AA4D"},
		{"chainId": 421614, "token": "`+arbUSDC+`"}]}`); r.status != http.StatusOK ||
		!reflect.DeepEqual(on(r), map[string]bool{usdc: true, arbUSDC: false}) {
		t.Fatalf("PUT Arbitrum off: %d %v", r.status, r.body)
	}
	for name, body := range map[string]string{
		"every token":     `{"off": [{"chainId": 84532, "token": "` + usdc + `"}, {"chainId": 421614, "token": "` + arbUSDC + `"}]}`,
		"a disabled one":  `{"off": [{"chainId": 84532, "token": "0x2222222222222222222222222222222222222222"}]}`,
		"an unknown one":  `{"off": [{"chainId": 1, "token": "` + usdc + `"}]}`,
		"a malformed one": `{"off": [{"chainId": 84532, "token": "usdc"}]}`,
	} {
		if r := e.call(t, "PUT", path, alice, "", body); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("PUT %s off: %d %v", name, r.status, r.body)
		}
	}
	if r := e.call(t, "GET", path, alice, "", ""); !reflect.DeepEqual(on(r), map[string]bool{usdc: true, arbUSDC: false}) {
		t.Fatalf("a refused PUT changed the switches: %v", r.body)
	}
	if r := e.call(t, "GET", path, bob, "", ""); r.status != http.StatusForbidden {
		t.Fatalf("Bob reads Alice's tokens: %d", r.status)
	}

	options := func(r reply) []string {
		var out []string
		list, _ := r.body["options"].([]any)
		for _, o := range list {
			out = append(out, o.(map[string]any)["token"].(string))
		}
		return out
	}
	if r := e.post(t, alice, e.aliceProfile, "key-1", `{"amountUsd": "5"}`); r.status != http.StatusCreated ||
		!reflect.DeepEqual(options(r), []string{usdc}) {
		t.Fatalf("payer chooses leaves Arbitrum out: %d %v", r.status, options(r))
	}
	if r := e.post(t, alice, e.aliceProfile, "key-2", `{"chainId": 421614, "token": "`+arbUSDC+`", "amount": "1000000"}`); r.status !=
		http.StatusUnprocessableEntity {
		t.Fatalf("a fixed token that is off: %d %v", r.status, r.body)
	}
	got := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+earlier.body["invoiceId"].(string), alice, "", "")
	if len(options(got)) != 2 {
		t.Fatalf("an invoice made before keeps both options: %v", options(got))
	}

	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	storePath := "/v1/profiles/" + shop + "/stores/" + store
	saved := e.call(t, "PUT", storePath, alice, "", `{"name": "Shop", "defaultExpiresIn": 3600,
		"tokensOff": [{"chainId": 84532, "token": "`+usdc+`"}]}`)
	if want := []any{map[string]any{"chainId": float64(84532), "token": usdc}}; saved.status != http.StatusOK ||
		!reflect.DeepEqual(saved.body["tokensOff"], want) {
		t.Fatalf("PUT a store's tokensOff: %d %v", saved.status, saved.body)
	}
	if r := e.call(t, "GET", "/v1/profiles/"+shop+"/stores", alice, "", ""); !reflect.DeepEqual(
		r.body["stores"].([]any)[0].(map[string]any)["tokensOff"], saved.body["tokensOff"]) {
		t.Fatalf("the list's tokensOff: %v", r.body)
	}
	if r := e.post(t, alice, shop, "key-3", `{"amountUsd": "5"}`); r.status != http.StatusCreated ||
		!reflect.DeepEqual(options(r), []string{arbUSDC}) {
		t.Fatalf("the store leaves Base out: %d %v", r.status, options(r))
	}
	if r := e.call(t, "PUT", storePath, alice, "", `{"name": "Shop", "defaultExpiresIn": 3600, "tokensOff":
		[{"chainId": 84532, "token": "`+usdc+`"}, {"chainId": 421614, "token": "`+arbUSDC+`"}]}`); r.status !=
		http.StatusUnprocessableEntity {
		t.Fatalf("a store with every token off: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/tokens", alice, "", `{"off": [{"chainId": 421614,
		"token": "`+arbUSDC+`"}]}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("turning off the store's last token: %d %v", r.status, r.body)
	}
	if r := e.post(t, alice, shop, "key-4", `{"amountUsd": "5"}`); r.status != http.StatusCreated {
		t.Fatalf("store still has its token after the refused save: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", storePath, alice, "", `{"name": "Shop", "defaultExpiresIn": 3600}`); r.status != http.StatusOK {
		t.Fatal(r.body)
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/tokens", alice, "", `{"off": [{"chainId": 421614,
		"token": "`+arbUSDC+`"}]}`); r.status != http.StatusOK {
		t.Fatal(r.body)
	}
	if r := e.call(t, "PUT", storePath, alice, "", `{"name": "Shop", "defaultExpiresIn": 3600,
		"tokensOff": [{"chainId": 84532, "token": "`+usdc+`"}]}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("store turns off the profile's last token: %d %v", r.status, r.body)
	}

	// A token an operator disables later leaves the lists, so what a read gives back saves again.
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/tokens", alice, "", `{"off": []}`); r.status != http.StatusOK {
		t.Fatal(r.body)
	}
	if _, err := e.pool.Exec(context.Background(), "UPDATE tokens SET enabled = false WHERE chain_id = 84532"); err != nil {
		t.Fatal(err)
	}
	read := e.call(t, "GET", "/v1/profiles/"+shop+"/stores", alice, "", "").body["stores"].([]any)[0].(map[string]any)
	if off := read["tokensOff"].([]any); len(off) != 0 {
		t.Fatalf("a store's tokensOff lists a disabled token: %v", off)
	}
	if r := e.call(t, "PUT", storePath, alice, "", `{"name": "Shop", "defaultExpiresIn": 3600, "tokensOff": []}`); r.status !=
		http.StatusOK {
		t.Fatalf("PUT the store as read: %d %v", r.status, r.body)
	}
	// With no token enabled, as on a new database, stores and the switches still save.
	if _, err := e.pool.Exec(context.Background(), "UPDATE tokens SET enabled = false"); err != nil {
		t.Fatal(err)
	}
	if r := e.call(t, "PUT", storePath, alice, "", `{"name": "Shop", "defaultExpiresIn": 3600}`); r.status != http.StatusOK {
		t.Fatalf("PUT a store with no token enabled: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path, alice, "", `{"off": []}`); r.status != http.StatusOK {
		t.Fatalf("PUT the switches with no token enabled: %d %v", r.status, r.body)
	}
}

func TestTokenPreferencesKeepOneTokenPerMode(t *testing.T) {
	e := invoiceAPI(t)
	e.enableArbUSDC(t)
	e.exec(t, "UPDATE chains SET livemode = true WHERE chain_id = 421614")
	const alice = "did:privy:alice"
	path := "/v1/profiles/" + e.aliceProfile + "/tokens"
	for _, off := range []string{
		`{"chainId": 84532, "token": "` + usdc + `"}`,
		`{"chainId": 421614, "token": "` + arbUSDC + `"}`,
	} {
		if r := e.call(t, "PUT", path, alice, "", `{"off": [`+off+`]}`); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("last token of one mode off: %d %v", r.status, r.body)
		}
	}
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+store, alice, "", `{"name": "Shop",
		"defaultExpiresIn": 3600, "tokensOff": [{"chainId": 421614, "token": "`+arbUSDC+`"}]}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("store's last live token off: %d %v", r.status, r.body)
	}
}

func TestTempoAppearsOffAndCanBeEnabled(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	const tempo = "0x20c0000000000000000000006a37da5c996874be"
	path := "/v1/profiles/" + e.aliceProfile + "/tokens"
	startup := func() {
		t.Helper()
		if err := chain.EnableTestnetTokens(ctx, e.pool); err != nil {
			t.Fatal(err)
		}
	}
	check := func(want bool) {
		t.Helper()
		r := e.call(t, "GET", path, "did:privy:alice", "", "")
		if r.status != http.StatusOK {
			t.Fatalf("list tokens: %d %v", r.status, r.body)
		}
		for _, item := range r.body["tokens"].([]any) {
			tok := item.(map[string]any)
			if tok["token"] == tempo {
				if tok["on"] != want {
					t.Fatalf("Tempo on = %v; want %v", tok["on"], want)
				}
				return
			}
		}
		t.Fatal("Tempo is missing from Networks")
	}
	startup()
	check(false)
	e.exec(t, `INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (42431, 0, 0)`)
	fixed := `{"chainId":42431,"token":"` + tempo + `","amount": "1000000"}`
	if r := e.post(t, "did:privy:alice", e.aliceProfile, "tempo-off", fixed); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("invoice while Tempo off: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path, "did:privy:alice", "", `{"off":[]}`); r.status != http.StatusOK {
		t.Fatalf("turn Tempo on: %d %v", r.status, r.body)
	}
	startup()
	check(true)
	if r := e.post(t, "did:privy:alice", e.aliceProfile, "tempo-on", fixed); r.status != http.StatusCreated {
		t.Fatalf("invoice while Tempo on: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path, "did:privy:alice", "", `{"off":[{"chainId":42431,"token":"`+tempo+`"}]}`); r.status != http.StatusOK {
		t.Fatalf("turn Tempo off: %d %v", r.status, r.body)
	}
	startup()
	check(false)
	path = "/v1/profiles/" + e.merchant(t) + "/tokens"
	check(false)
}
