package canary_test

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/canary"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/config"
)

const (
	id        = "0x1c0ffee0000000000000000000000000000000000000000000000000000000ab"
	recipient = "0x1111111111111111111111111111111111111111"
	token     = "0x2222222222222222222222222222222222222222"
	amount    = "2500000"
	expiresAt = 1893456000 // 2030-01-01
	deadline  = expiresAt + 86400
	wrong     = "0x3333333333333333333333333333333333333333"
	// The pay link of a payer-chooses invoice that has id as one of its options.
	payID = "0x2c0ffee0000000000000000000000000000000000000000000000000000000cd"
)

// line is the invoice as the database lists it on the canary's stdin.
var line = fmt.Sprintf("%s %d %s %s %s %d %d USDC anvil", id, chaintest.ChainID, recipient, token, amount, expiresAt,
	deadline)

// setup is what one case serves and configures.
type setup struct {
	rpc2, codeHash, pageAddress, qrAddress, network, payID string
	chainKey                                               uint64
	api                                                    map[string]any
}

// option is the api's first listed option, the one the line names.
func (s setup) option() map[string]any { return s.api["options"].([]map[string]any)[0] }

func TestCheck(t *testing.T) {
	a, b := chaintest.Start(t), chaintest.Start(t)
	factory := a.DeployFactory()
	b.DeployFactory()
	lying := b.Proxy()
	lying.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method == "eth_call" {
			return json.RawMessage(`"0x000000000000000000000000` + wrong[2:] + `"`)
		}
		return nil
	})
	// Foundry's own ABI encoder, so the test does not trust the canary's.
	want := cast(t, "call", factory, "predict((bytes32,address,address,uint256,uint64,uint64,uint256))(address)",
		fmt.Sprintf("(%s,%s,%s,%s,%d,%d,%d)", id, recipient, token, amount, expiresAt, deadline, chaintest.ChainID),
		"--rpc-url", a.URL)
	codeHash := cast(t, "codehash", factory, "--rpc-url", a.URL)
	script, err := filepath.Abs("../../../web/scripts/canary-pay-page.ts")
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name   string
		change func(*setup)
		alert  string
	}{
		{name: "addresses match"},
		{name: "api address changed", change: func(s *setup) { s.option()["receiveAddress"] = wrong },
			alert: "api shows " + wrong},
		{name: "api amount changed", change: func(s *setup) { s.option()["amount"] = "1" }, alert: "api amount 1"},
		{name: "api lists no such option", change: func(s *setup) { s.option()["optionId"] = payID },
			alert: "api lists no option " + id},
		{name: "option of a payer-chooses invoice", change: func(s *setup) {
			s.payID = payID
			s.api["invoiceId"] = payID
		}},
		{name: "page of a payer-chooses invoice shows another option", change: func(s *setup) {
			s.payID = payID
			s.api["invoiceId"] = payID
			s.pageAddress = wrong
		}, alert: fmt.Sprintf("pay page shows [%s]", wrong)},
		{name: "api recipient changed", change: func(s *setup) { s.api["recipient"] = wrong }, alert: "api recipient " + wrong},
		{name: "api factory changed", change: func(s *setup) { s.api["factory"] = wrong }, alert: "api factory " + wrong},
		{name: "page address changed", change: func(s *setup) { s.pageAddress = wrong },
			alert: fmt.Sprintf("pay page shows [%s]", wrong)},
		{name: "page QR code for another address", change: func(s *setup) { s.qrAddress = wrong },
			alert: "pay page QR code does not encode the shown address " + want},
		{name: "page shows no address", change: func(s *setup) { s.pageAddress = "" }, alert: "not open for payment"},
		{name: "rpcs disagree", change: func(s *setup) { s.rpc2 = lying.URL }, alert: "RPCs disagree"},
		{name: "factory code changed", change: func(s *setup) { s.codeHash = "0x" + strings.Repeat("0", 64) },
			alert: "factory code hash"},
		{name: "rpc on another chain", change: func(s *setup) { s.chainKey = 84532 }, alert: "chain id 31337, want 84532"},
		{name: "page names another network", change: func(s *setup) { s.network = "Base Sepolia" },
			alert: "want USDC on anvil"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := setup{rpc2: b.URL, codeHash: codeHash, pageAddress: want, qrAddress: want, network: "Anvil (local)",
				chainKey: chaintest.ChainID, payID: id,
				api: map[string]any{"invoiceId": id, "chainId": chaintest.ChainID, "token": token, "amount": amount,
					"recipient": recipient, "factory": factory, "receiveAddress": want,
					"expiresAt": "2030-01-01T00:00:00Z", "settleDeadline": "2030-01-02T00:00:00Z",
					"options": []map[string]any{{"optionId": id, "chainId": chaintest.ChainID, "token": token,
						"amount": amount, "receiveAddress": want}}}}
			if tc.change != nil {
				tc.change(&s)
			}
			origin := serve(t, s.payID, maps.Clone(s.api), s.pageAddress, qrPath(t, s.qrAddress), s.network)
			cfg := config.Canary{APIURL: origin, WebURL: origin, Factory: factory, FactoryCodeHash: s.codeHash,
				RPCURLs: map[uint64][2]string{s.chainKey: {a.URL, s.rpc2}}, PageScript: script}
			input := line
			if s.payID != id {
				input += " " + s.payID
			}
			alerts := canary.Check(context.Background(), cfg, []string{input})
			if tc.alert == "" && len(alerts) != 0 {
				t.Fatalf("got alerts %q", alerts)
			}
			if tc.alert != "" && (len(alerts) == 0 || !strings.Contains(strings.Join(alerts, "\n"), tc.alert)) {
				t.Fatalf("got alerts %q, want one containing %q", alerts, tc.alert)
			}
		})
	}
}

func TestCheckRejectsMalformedInput(t *testing.T) {
	for _, bad := range []string{id, strings.Replace(line, recipient, "0x11", 1), strings.Replace(line, amount, "-1", 1),
		strings.Replace(line, amount, "0", 1), strings.Replace(line, fmt.Sprint(deadline), fmt.Sprint(deadline+1), 1),
		strings.Replace(line, recipient, "0x0000000000000000000000000000000000000000", 1),
		strings.Replace(line, recipient, token, 1)} {
		alerts := canary.Check(context.Background(), config.Canary{}, []string{bad})
		if len(alerts) != 1 || !strings.Contains(alerts[0], "input line") {
			t.Errorf("%q: got alerts %q", bad, alerts)
		}
	}
}

// The canary must not share address code or constants with the api, so only these packages of this repository
// may build it.
func TestImportsNoAppCode(t *testing.T) {
	out, err := exec.Command("go", "list", "-deps", "../../cmd/canary").CombinedOutput()
	if err != nil {
		t.Fatalf("go list: %v\n%s", err, out)
	}
	const module = "github.com/ensp1re/forwend/"
	allowed := map[string]bool{module + "apps/backend/cmd/canary": true, module + "apps/backend/internal/canary": true,
		module + "apps/backend/internal/config": true}
	for _, pkg := range strings.Fields(string(out)) {
		if strings.HasPrefix(pkg, module) && !allowed[pkg] {
			t.Errorf("cmd/canary depends on %s", pkg)
		}
	}
}

// serve answers the api's GET /v1/invoices/<pay> with api, and /pay/<pay> with a page laid out like the real one that
// shows address and a QR code drawn as qr once Show address is pressed, or a closed invoice without it when address
// is "". An option's page must be asked for by
// ?option=<id>.
func serve(t *testing.T, pay string, api map[string]any, address, qr, network string) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if pay != id && r.URL.Path == "/pay/"+pay && r.URL.Query().Get("option") != id {
			http.NotFound(w, r)
			return
		}
		switch r.URL.Path {
		case "/v1/invoices/" + pay:
			_ = json.NewEncoder(w).Encode(api)
		case "/pay/" + pay:
			page := `<!doctype html><main><section aria-labelledby="pay-amount"><h2 id="pay-amount">Amount due</h2>` +
				`<p>2.50</p><p>USDC</p><p>` + network + `</p></section>`
			if address != "" {
				panel := fmt.Sprintf(`<svg role="img"><path d="%s"/></svg><p>Send to</p><p>%s</p>`, qr, address)
				page += `<section aria-labelledby="pay-before"><button>Show address</button></section>` +
					`<section aria-labelledby="pay-send"></section><script>
document.querySelector('[aria-labelledby="pay-before"] button').onclick = () => {
  document.querySelector('[aria-labelledby="pay-send"]').innerHTML = '` + panel + `';
};
</script>`
			}
			fmt.Fprint(w, page+"</main>")
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// qrPath draws address as packages/ui-web's QrCode does.
func qrPath(t *testing.T, address string) string {
	t.Helper()
	cmd := exec.Command("node", "--input-type=module", "-e", `import { encode } from "uqr";
const { data } = encode(process.argv[1], { border: 4 });
console.log(data.flatMap((row, y) => row.map((on, x) => (on ? "M" + x + " " + y + "h1v1h-1z" : ""))).join(""));`,
		address)
	cmd.Dir = "../../../web"
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("draw QR: %v\n%s", err, out)
	}
	return strings.TrimSpace(string(out))
}

func cast(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.Command("cast", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("cast %s: %v\n%s", args[0], err, out)
	}
	return strings.ToLower(strings.TrimSpace(string(out)))
}
