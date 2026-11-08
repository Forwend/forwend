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
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/forwend/forwend/apps/backend/internal/canary"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/config"
)

const (
	// The line's invoice's pay link token (D-86).
	payToken  = "1c0ffee0000000000000000000000000000000000000000000000000000000ab"
	recipient = "0x1111111111111111111111111111111111111111"
	token     = "0x2222222222222222222222222222222222222222"
	amount    = "2500000"
	expiresAt = 1893456000 // 2030-01-01
	deadline  = expiresAt + 86400
	wrong     = "0x3333333333333333333333333333333333333333"
	// The pay link's token of a payer-chooses invoice that has id as one of its options.
	otherToken = "2c0ffee0000000000000000000000000000000000000000000000000000000cd"
)

var (
	id, otherID = idOf(payToken), idOf(otherToken)
	line        = lineOf(payToken)
)

func idOf(pay string) string { return crypto.Keccak256Hash(common.FromHex(pay)).Hex() }

func lineOf(pay string) string {
	return fmt.Sprintf("%s %d %s %s %s %d %d USDC anvil %s %d 0 0", id, chaintest.ChainID, recipient, token, amount,
		expiresAt, deadline, pay, expiresAt)
}

// withClose is line with its closes_at field set to at.
func withClose[T int | int64 | uint64](line string, at T) string {
	f := strings.Fields(line)
	f[10] = fmt.Sprint(at)
	return strings.Join(f, " ")
}

type setup struct {
	rpc2, codeHash, pageAddress, qrAddress, network, payToken string
	chainKey                                                  uint64
	api                                                       map[string]any
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
	want := cast(t, "call", factory, "predict((bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256))(address)",
		fmt.Sprintf("(%s,%s,%s,%s,%d,%d,%d,0,0)", id, recipient, token, amount, expiresAt, deadline, chaintest.ChainID),
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
		{name: "api lists no such option", change: func(s *setup) { s.option()["optionId"] = otherID },
			alert: "api lists no option " + id},
		{name: "api answers another invoice", change: func(s *setup) { s.api["invoiceId"] = otherID },
			alert: "api invoiceId " + otherID},
		{name: "option of a payer-chooses invoice", change: func(s *setup) {
			s.payToken = otherToken
			s.api["invoiceId"] = otherID
		}},
		{name: "page of a payer-chooses invoice shows another option", change: func(s *setup) {
			s.payToken = otherToken
			s.api["invoiceId"] = otherID
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
				chainKey: chaintest.ChainID, payToken: payToken,
				api: map[string]any{"invoiceId": id, "chainId": chaintest.ChainID, "token": token, "amount": amount,
					"recipient": recipient, "factory": factory, "receiveAddress": want,
					"expiresAt": "2030-01-01T00:00:00Z", "settleDeadline": "2030-01-02T00:00:00Z",
					"options": []map[string]any{{"optionId": id, "chainId": chaintest.ChainID, "token": token,
						"amount": amount, "receiveAddress": want, "networkFee": "0", "platformFee": "0"}}}}
			if tc.change != nil {
				tc.change(&s)
			}
			origin := serve(t, s.payToken, maps.Clone(s.api), s.pageAddress, qrPath(t, s.qrAddress), s.network)
			cfg := config.Canary{AllowLoopback: true, APIURL: origin, WebURL: origin, Factory: factory, FactoryFees: true, FactoryCodeHash: s.codeHash,
				RPCURLs: map[uint64][2]string{s.chainKey: {a.URL, s.rpc2}}, PageScript: script}
			alerts := canary.Check(context.Background(), cfg, []string{lineOf(s.payToken)})
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
	// The line ends with its close (R-130).
	closing := func(at int) string { return withClose(line, at) }
	for _, bad := range []string{id, closing(0), closing(deadline), strings.Replace(line, recipient, "0x11", 1), strings.Replace(line, amount, "-1", 1),
		strings.Replace(line, amount, "0", 1), strings.Replace(line, fmt.Sprint(deadline), fmt.Sprint(deadline+1), 1),
		strings.Replace(line, fmt.Sprint(deadline), fmt.Sprint(expiresAt+2*86400), 1),
		strings.Replace(line, recipient, "0x0000000000000000000000000000000000000000", 1),
		strings.Replace(line, recipient, token, 1)} {
		alerts := canary.Check(context.Background(), config.Canary{AllowLoopback: true}, []string{bad})
		if len(alerts) != 1 || !strings.Contains(alerts[0], "input line") {
			t.Errorf("%q: got alerts %q", bad, alerts)
		}
	}
	// D-18: invoices made before the 7-day window settle 1 day after expiry; both are create's rules.
	week := strings.Replace(line, fmt.Sprint(deadline), fmt.Sprint(expiresAt+7*86400), 1)
	for _, good := range []string{week, closing(deadline - 1), closing(expiresAt - 1)} {
		for _, alert := range canary.Check(context.Background(), config.Canary{AllowLoopback: true}, []string{good}) {
			if strings.Contains(alert, "input line") {
				t.Errorf("%q: %q", good, alert)
			}
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
	const module = "github.com/forwend/forwend/"
	allowed := map[string]bool{module + "apps/backend/cmd/canary": true, module + "apps/backend/internal/canary": true,
		module + "apps/backend/internal/config": true, module + "apps/backend/internal/outbound": true}
	for _, pkg := range strings.Fields(string(out)) {
		if strings.HasPrefix(pkg, module) && !allowed[pkg] {
			t.Errorf("cmd/canary depends on %s", pkg)
		}
	}
}

// serve fakes the api's invoice and a pay page that shows address and its QR once Show address is pressed; the page
// needs ?option=<id>, and address "" makes it a closed invoice.
func serve(t *testing.T, pay string, api map[string]any, address, qr, network string) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/pay/"+pay && r.URL.Query().Get("option") != id {
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

func TestCheckFirstOptionOfPayerChoosesInvoice(t *testing.T) {
	a := chaintest.Start(t)
	factory := a.DeployFactory()
	want := cast(t, "call", factory, "predict((bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256))(address)",
		fmt.Sprintf("(%s,%s,%s,%s,%d,%d,%d,0,0)", id, recipient, token, amount, expiresAt, deadline, chaintest.ChainID),
		"--rpc-url", a.URL)
	codeHash := cast(t, "codehash", factory, "--rpc-url", a.URL)
	script, err := filepath.Abs("../../../web/scripts/canary-pay-page.ts")
	if err != nil {
		t.Fatal(err)
	}
	api := map[string]any{"invoiceId": id, "chainId": chaintest.ChainID, "token": token, "amount": amount,
		"recipient": recipient, "factory": factory, "receiveAddress": want,
		"expiresAt": "2030-01-01T00:00:00Z", "settleDeadline": "2030-01-02T00:00:00Z", "optionLocked": false,
		"options": []map[string]any{
			{"optionId": id, "chainId": chaintest.ChainID, "token": token, "amount": amount, "receiveAddress": want,
				"networkFee": "0", "platformFee": "0"},
			{"optionId": otherID, "chainId": 84532, "token": wrong, "amount": amount, "receiveAddress": wrong},
		}}
	qr := qrPath(t, want)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/invoices/" + payToken:
			_ = json.NewEncoder(w).Encode(api)
		case "/pay/" + payToken:
			page := `<!doctype html><main><section aria-labelledby="pay-amount"><h2 id="pay-amount">Amount due</h2>` +
				`<p>2.50</p><p>USDC</p><p>Anvil (local)</p></section>`
			if r.URL.Query().Get("option") != id {
				page += `<section aria-labelledby="pay-before"><div role="combobox">Network</div>` +
					`<div role="combobox">Token</div></section>`
			} else {
				panel := fmt.Sprintf(`<svg role="img"><path d="%s"/></svg><p>Send to</p><p>%s</p>`, qr, want)
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

	cfg := config.Canary{AllowLoopback: true, APIURL: srv.URL, WebURL: srv.URL, Factory: factory, FactoryFees: true, FactoryCodeHash: codeHash,
		RPCURLs: map[uint64][2]string{chaintest.ChainID: {a.URL, a.URL}}, PageScript: script}
	if alerts := canary.Check(context.Background(), cfg, []string{line}); len(alerts) != 0 {
		t.Fatalf("an honest payer-chooses invoice alerts: %q", alerts)
	}
}

func TestCheckSkipsInvoicesThePayPageClosed(t *testing.T) {
	a := chaintest.Start(t)
	factory := a.DeployFactory()
	script, err := filepath.Abs("../../../web/scripts/canary-pay-page.ts")
	if err != nil {
		t.Fatal(err)
	}
	soon := time.Now().Add(2 * time.Minute).Unix()
	input := fmt.Sprintf("%s %d %s %s %s %d %d USDC anvil %s %d 0 0", id, chaintest.ChainID, recipient, token, amount, soon,
		soon+86400, payToken, soon)
	origin := serve(t, payToken, map[string]any{}, "", "", "Anvil (local)")
	cfg := config.Canary{AllowLoopback: true, APIURL: origin, WebURL: origin, Factory: factory, FactoryFees: true,
		FactoryCodeHash: cast(t, "codehash", factory, "--rpc-url", a.URL),
		RPCURLs:         map[uint64][2]string{chaintest.ChainID: {a.URL, a.URL}}, PageScript: script}
	if alerts := canary.Check(context.Background(), cfg, []string{input}); len(alerts) != 0 {
		t.Fatalf("an invoice 2 minutes from expiry alerts: %q", alerts)
	}
	// R-130: a reopened invoice is checked until its new close, so this empty answer alerts.
	past := time.Now().Add(-time.Hour).Unix()
	reopened := fmt.Sprintf("%s %d %s %s %s %d %d USDC anvil %s %d 0 0", id, chaintest.ChainID, recipient, token, amount,
		past, past+604800, payToken, past+518400)
	alerts := canary.Check(context.Background(), cfg, []string{reopened})
	if len(alerts) == 0 || slices.ContainsFunc(alerts, func(a string) bool { return strings.Contains(a, "input line") }) {
		t.Fatalf("a reopened invoice past its expiry was skipped or refused: %q", alerts)
	}
}

func TestEarlyCloseRequiresBothProvidersDeploymentEvidence(t *testing.T) {
	a := chaintest.Start(t)
	factory := a.DeployFactory()
	args := fmt.Sprintf("(%s,%s,%s,%s,%d,%d,%d,0,0)", id, recipient, token, amount, expiresAt, deadline, chaintest.ChainID)
	predicted := cast(t, "call", factory, "predict((bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256))(address)", args, "--rpc-url", a.URL)
	a.AsAuthority(factory, "deploy((bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256))", args)
	a.Mine(2)
	deployed := cast(t, "call", factory, "deployedAt(address)(uint256)", predicted, "--rpc-url", a.URL)
	var timestamp uint64
	if _, err := fmt.Sscan(strings.Fields(deployed)[0], &timestamp); err != nil {
		t.Fatal(err)
	}
	closeAt := timestamp + 29*86400
	script, err := filepath.Abs("../../../web/scripts/canary-pay-page.ts")
	if err != nil {
		t.Fatal(err)
	}
	api := map[string]any{"invoiceId": id, "chainId": chaintest.ChainID, "token": token, "amount": amount,
		"recipient": recipient, "factory": factory, "receiveAddress": predicted, "expiresAt": "2030-01-01T00:00:00Z",
		"settleDeadline": "2030-01-02T00:00:00Z", "options": []map[string]any{{"optionId": id, "chainId": chaintest.ChainID, "token": token, "amount": amount, "receiveAddress": predicted,
			"networkFee": "0", "platformFee": "0"}}}
	origin := serve(t, payToken, api, predicted, qrPath(t, predicted), "Anvil (local)")
	cfg := config.Canary{AllowLoopback: true, APIURL: origin, WebURL: origin, Factory: factory, FactoryFees: true, FactoryCodeHash: cast(t, "codehash", factory, "--rpc-url", a.URL),
		RPCURLs: map[uint64][2]string{chaintest.ChainID: {a.URL, a.URL}}, PageScript: script}
	input := withClose(line, closeAt)
	if alerts := canary.Check(t.Context(), cfg, []string{input}); len(alerts) != 0 {
		t.Fatalf("verified early close: %v", alerts)
	}
	wrongClose := withClose(line, closeAt+1)
	if alerts := canary.Check(t.Context(), cfg, []string{wrongClose}); !slices.ContainsFunc(alerts, func(s string) bool { return strings.Contains(s, "early close disagrees") }) {
		t.Fatalf("unproved early close accepted: %v", alerts)
	}
}
