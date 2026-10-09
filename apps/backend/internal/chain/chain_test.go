package chain

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
)

// The first two working hosts are picked; a URL answering another chain is skipped; one host serves both roles.
func TestDialPicksTwoHostsOnTheRightChain(t *testing.T) {
	ctx := context.Background()
	wrong := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x1"}`))
	}))
	defer wrong.Close()
	a, b := chaintest.Start(t), chaintest.Start(t)

	r, err := Dial(ctx, Spec{ChainID: chaintest.ChainID, Public: []string{wrong.URL, a.URL, a.URL, b.URL}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if r.Primary == nil || r.Second == nil || r.Primary == r.Second {
		t.Fatalf("want two different clients, got %+v", r)
	}

	one, err := Dial(ctx, Spec{ChainID: chaintest.ChainID, Public: []string{a.URL}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer one.Close()
	if one.Primary != one.Second {
		t.Fatal("with one host, both roles should share it")
	}
	if _, err := Dial(ctx, Spec{ChainID: chaintest.ChainID, Public: []string{wrong.URL}}, nil); err == nil {
		t.Fatal("a wrong-chain RPC was accepted")
	}
}
