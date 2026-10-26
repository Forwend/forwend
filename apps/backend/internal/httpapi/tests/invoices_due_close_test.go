package tests

import (
	"net/http"
	"testing"
	"time"
)

// R-152: a due date with no expiresIn closes 60 days past it, whatever the store's own default close.
func TestDueDateOutranksTheStoreDefault(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop",
		"defaultExpiresIn": 3600}`); r.status != http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	due := time.Now().UTC().AddDate(0, 0, 30).Format(time.DateOnly)
	day, _ := time.Parse(time.DateOnly, due)
	body := `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "storeId": "` + storeB + `"`
	r := e.post(t, alice, shop, "key-1", body+`, "dueDate": "`+due+`"}`)
	if want := day.AddDate(0, 0, 61).Format(time.RFC3339); r.status != http.StatusCreated || r.body["expiresAt"] != want ||
		r.body["closesAt"] != want {
		t.Fatalf("due %s: %d expires %v closes %v, want %s", due, r.status, r.body["expiresAt"], r.body["closesAt"], want)
	}
	// Without a due date the store's default stays.
	r = e.post(t, alice, shop, "key-2", body+`}`)
	expires, _ := time.Parse(time.RFC3339, r.body["expiresAt"].(string))
	if r.status != http.StatusCreated || time.Until(expires) > time.Hour+time.Minute || time.Until(expires) < 58*time.Minute {
		t.Fatalf("no due date: %d expires %v, want in an hour", r.status, r.body["expiresAt"])
	}
}
