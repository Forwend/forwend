package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

func TestDatabaseEndpointConfiguration(t *testing.T) {
	ctx := t.Context()
	dbURL := databasetest.New(t)
	if err := database.Migrate(ctx, dbURL); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE chains SET enabled=true WHERE chain_id=84532`)
	exec(`INSERT INTO rpc_endpoints(chain_id,id,provider,role,tier,priority,secret_ref,budget_group)
 VALUES(84532,'private-a','operator-a','primary','private',0,'BASE_PRIVATE','account-a')`)
	secrets := map[string]string{"BASE_PRIVATE": "https://private.example/api/DO-NOT-PRINT?key=PRIVATE"}
	if _, err := Specs(ctx, db, nil, false); err == nil {
		t.Fatal("missing secret accepted")
	}
	specs, err := Specs(ctx, db, secrets, false)
	if err != nil {
		t.Fatal(err)
	}
	s := specs[84532]
	if s.Name != "base-sepolia" || len(s.Endpoints) != 4 || ordered(s.Endpoints)[0].ID != "private-a" {
		t.Fatal("registry lost chain or endpoint priority")
	}
	for _, e := range s.Endpoints {
		if strings.Contains(e.String(), "PRIVATE") {
			t.Fatal("endpoint formatting exposes secret")
		}
	}
	exec(`UPDATE rpc_endpoints SET enabled=false WHERE id='private-a'`)
	if _, err := Specs(ctx, db, nil, false); err != nil {
		t.Fatalf("disabled endpoint requires a secret: %v", err)
	}
	exec(`UPDATE rpc_endpoints SET enabled=true,provider='publicnode' WHERE id='private-a'`)
	if _, err := Specs(ctx, db, secrets, false); err == nil {
		t.Fatal("one provider can confirm itself")
	}
	exec(`UPDATE rpc_endpoints SET provider='operator-a' WHERE id='private-a'`)
	for _, bad := range []string{"http://private.example/SECRET", "https://user:SECRET@example.com", "https://169.254.169.254/SECRET", "https://[::1]/SECRET", "https://example.com/#SECRET", "https://"} {
		_, err := Specs(ctx, db, map[string]string{"BASE_PRIVATE": bad}, false)
		if err == nil || strings.Contains(err.Error(), "SECRET") {
			t.Fatalf("unsafe URL or secret error accepted: %v", err)
		}
	}
	if _, err := db.Exec(ctx, `UPDATE rpc_endpoints SET public_url='https://secret.example' WHERE id='private-a'`); err == nil {
		t.Fatal("private URL stored in database")
	}
	if _, err := db.Exec(ctx, `UPDATE rpc_endpoints SET role='both' WHERE id='private-a'`); err == nil {
		t.Fatal("invalid role stored")
	}
	if _, err := db.Exec(ctx, `UPDATE rpc_endpoints SET priority=-1 WHERE id='private-a'`); err == nil {
		t.Fatal("negative priority stored")
	}
	exec(`UPDATE rpc_endpoints SET provider='operator-b',role='confirmation',secret_ref='ALIAS' WHERE id='private-a'`)
	for _, alias := range []string{"https://sepolia.base.org:443/private", "https://SEPOLIA.BASE.ORG./private"} {
		_, err = Specs(ctx, db, map[string]string{"ALIAS": alias}, false)
		if err == nil {
			t.Fatal("same host alias accepted across roles")
		}
	}
}

func TestRegistryRejectsInvalidEndpointMetadata(t *testing.T) {
	valid := Spec{ChainID: 1, Endpoints: []Endpoint{
		{ID: "a", Provider: "a", Role: Primary, Tier: Private, URL: "https://a.example/key", BudgetGroup: "a"},
		{ID: "b", Provider: "b", Role: Confirmation, Tier: Public, URL: "https://b.example", BudgetGroup: "b"},
	}}
	for _, mutate := range []func(*Spec){
		func(s *Spec) { s.ChainID = 0 }, func(s *Spec) { s.Endpoints[1].Provider = "a" },
		func(s *Spec) { s.Endpoints[1].ID = "a" }, func(s *Spec) { s.Endpoints[1].URL = s.Endpoints[0].URL },
		func(s *Spec) { s.Endpoints[0].ID = "https://SECRET" }, func(s *Spec) { s.Endpoints[1].Role = Primary },
	} {
		s := valid
		s.Endpoints = append([]Endpoint{}, valid.Endpoints...)
		mutate(&s)
		if err := validate(s); err == nil {
			t.Fatal("invalid metadata accepted")
		}
	}
	if err := validate(valid); err != nil {
		t.Fatal(err)
	}
}

func TestConfigurationReadCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	dbURL := databasetest.New(t)
	db, err := database.Open(t.Context(), dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := Specs(ctx, db, nil, false); err == nil {
		t.Fatal("cancelled configuration read succeeded")
	}
}

func TestResolvedEndpointCannotSerializeItsCredential(t *testing.T) {
	endpoint := Endpoint{ID: "private", URL: "https://rpc.example/SECRET"}
	raw, err := json.Marshal(endpoint)
	if err != nil || strings.Contains(string(raw), "SECRET") || strings.Contains(fmt.Sprintf("%+v %#v", endpoint, endpoint), "SECRET") {
		t.Fatal("resolved endpoint exposed its credential")
	}
}
