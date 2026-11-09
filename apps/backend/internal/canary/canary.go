// Package canary checks invoices' receive addresses apart from the code that makes them (R-51). It must not import
// anything holding the factory address, or a tampered constant there would fool it too (TestImportsNoAppCode).
package canary

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os/exec"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

const timeout = 30 * time.Second

// The pay page hides the address 5 minutes before the close (CLOSE_EARLY_MS in apps/web); one more for the run.
const payPageCloses = 6 * time.Minute

var (
	invoiceID = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
	payToken  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	predictV1 = crypto.Keccak256([]byte("predict((bytes32,address,address,uint256,uint64,uint64,uint256))"))[:4]
	// v2 terms end with the network and platform fees (R-226).
	predictV2 = crypto.Keccak256([]byte("predict((bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256))"))[:4]
)

// terms is one stdin line: the invoice or one of its accepted options, as the database holds it. PayToken is the
// pay link's token of the invoice the line belongs to (D-86); ClosesAt is when its checkout closes (R-130).
type terms struct {
	ID, PayToken, Recipient, Token, Amount, Symbol, Network string
	NetworkFee, PlatformFee                                 string // in its terms with a v2 factory (R-226)
	ChainID, ExpiresAt, SettleDeadline, ClosesAt            uint64
}

// apiInvoice is the part of GET /v1/invoices/{payToken} the canary compares.
type apiInvoice struct {
	InvoiceID, Recipient, Token, Amount, ExpiresAt, SettleDeadline, Factory, ReceiveAddress string
	NetworkFee, PlatformFee                                                                 string
	ChainID                                                                                 uint64
	Options                                                                                 []apiOption
}

type apiOption struct {
	OptionID, Token, Amount, ReceiveAddress, NetworkFee, PlatformFee string
	ChainID                                                          uint64
}

// page always names the option: without it a payer-chooses link shows no address, also for its first option.
func (t terms) page() string {
	return t.PayToken + "?option=" + t.ID
}

type payPage struct {
	ID         string
	Addresses  []string
	QRMatches  bool
	AmountText string
	Error      string
}

// Check returns one alert for each difference or failed read; none means every invoice's address matched.
// ponytail: one invoice at a time; run invoices in parallel if a run gets too slow.
func Check(ctx context.Context, c config.Canary, lines []string) []string {
	var alerts []string
	rpcs := map[uint64][2]*rpc.Client{}
	for chainID, urls := range c.RPCURLs {
		var pair [2]*rpc.Client
		for i, u := range urls {
			httpClient := outbound.Client(c.AllowLoopback)
			defer httpClient.CloseIdleConnections()
			cl, err := rpc.DialOptions(ctx, u, rpc.WithHTTPClient(httpClient))
			if err != nil {
				alerts = append(alerts, fmt.Sprintf("chain %d rpc %d: %v", chainID, i+1, redact(err)))
				continue
			}
			defer cl.Close()
			pair[i] = cl
			if err := checkFactory(ctx, c, cl, chainID); err != nil {
				alerts = append(alerts, fmt.Sprintf("chain %d rpc %d: %v", chainID, i+1, err))
			}
		}
		rpcs[chainID] = pair
	}

	var invoices []terms
	var ids []string
	quotes := map[string][]quote{}
	for _, line := range lines {
		if strings.HasPrefix(line, "quote ") {
			q, err := parseQuote(line)
			if err != nil {
				alerts = append(alerts, fmt.Sprintf("input line %q: %v", line, err))
				continue
			}
			quotes[q.OptionID] = append(quotes[q.OptionID], q)
			continue
		}
		t, err := parseTerms(line)
		if err != nil {
			alerts = append(alerts, fmt.Sprintf("input line %q: %v", line, err))
			continue
		}
		if time.Until(time.Unix(int64(t.ClosesAt), 0)) < payPageCloses {
			continue
		}
		invoices = append(invoices, t)
		ids = append(ids, t.page())
	}
	pages, err := readPayPages(ctx, c, ids)
	if err != nil {
		alerts = append(alerts, fmt.Sprintf("pay page script: %v", err))
	}
	for _, t := range invoices {
		page, ok := pages[t.page()]
		if !ok {
			page.Error = "no result from the page script"
		}
		ictx, cancel := context.WithTimeout(ctx, timeout)
		receive, err := checkInvoice(ictx, c, rpcs, t, page)
		if err != nil {
			alerts = append(alerts, fmt.Sprintf("invoice %s: %v", t.ID, err))
		}
		// A quote is checked against the address the factory predicts, once the api and the page showed that one.
		for _, q := range quotes[t.ID] {
			if err == nil {
				if err := checkQuote(ictx, c, t, receive, q); err != nil {
					alerts = append(alerts, fmt.Sprintf("invoice %s quote %s: %v", t.ID, q.DepositAddress, err))
				}
			}
		}
		cancel()
	}
	return alerts
}

func checkFactory(ctx context.Context, c config.Canary, cl *rpc.Client, chainID uint64) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var id hexutil.Big
	if err := cl.CallContext(ctx, &id, "eth_chainId"); err != nil {
		return fmt.Errorf("chain id: %w", redact(err))
	}
	if got := (*big.Int)(&id); !got.IsUint64() || got.Uint64() != chainID {
		return fmt.Errorf("chain id %s, want %d", got, chainID)
	}
	var code hexutil.Bytes
	if err := cl.CallContext(ctx, &code, "eth_getCode", c.Factory, "latest"); err != nil {
		return fmt.Errorf("factory code: %w", redact(err))
	}
	if h := crypto.Keccak256Hash(code).Hex(); h != c.FactoryCodeHash {
		return fmt.Errorf("factory code hash %s, want %s", h, c.FactoryCodeHash)
	}
	return nil
}

// checkInvoice returns the receive address the factory predicts, once the api and the pay page show that one.
func checkInvoice(ctx context.Context, c config.Canary, rpcs map[uint64][2]*rpc.Client, t terms, page payPage) (string, error) {
	if !c.FactoryFees && (t.NetworkFee != "0" || t.PlatformFee != "0") {
		return "", errors.New("the terms carry fees, but the factory's terms have none")
	}
	api, err := readAPI(ctx, c.APIURL+"/v1/invoices/"+t.PayToken)
	if err != nil {
		return "", fmt.Errorf("api: %w", err)
	}
	// The link's invoice id is keccak256 of its pay token.
	if want := crypto.Keccak256Hash(common.FromHex(t.PayToken)).Hex(); api.InvoiceID != want {
		return "", fmt.Errorf("api invoiceId %s, want %s", api.InvoiceID, want)
	}
	// The option's own terms overwrite the invoice's; the others are shared.
	found := false
	for _, o := range api.Options {
		if o.OptionID == t.ID {
			api.InvoiceID, api.ChainID, api.Token, api.Amount, api.ReceiveAddress = o.OptionID, o.ChainID, o.Token,
				o.Amount, o.ReceiveAddress
			api.NetworkFee, api.PlatformFee = o.NetworkFee, o.PlatformFee
			found = true
		}
	}
	if !found {
		return "", fmt.Errorf("api lists no option %s", t.ID)
	}
	if err := sameTerms(c, t, api); err != nil {
		return "", err
	}
	pair, ok := rpcs[t.ChainID]
	if !ok {
		return "", fmt.Errorf("no RPCs configured for chain %d", t.ChainID)
	}
	var got [2]string
	for i, cl := range pair {
		if cl == nil {
			return "", fmt.Errorf("rpc %d unavailable", i+1)
		}
		var out hexutil.Bytes
		err := cl.CallContext(ctx, &out, "eth_call", map[string]any{"to": c.Factory, "data": hexutil.Bytes(t.predictCall(c.FactoryFees))},
			"latest")
		if err != nil {
			return "", fmt.Errorf("rpc %d predict: %w", i+1, redact(err))
		}
		if len(out) != 32 {
			return "", fmt.Errorf("rpc %d predict: %d bytes, want 32", i+1, len(out))
		}
		got[i] = strings.ToLower(common.BytesToAddress(out).Hex())
		if t.ClosesAt < t.ExpiresAt {
			data := append(crypto.Keccak256([]byte("deployedAt(address)"))[:4], common.LeftPadBytes(common.HexToAddress(got[i]).Bytes(), 32)...)
			if err := cl.CallContext(ctx, &out, "eth_call", map[string]any{"to": c.Factory, "data": hexutil.Bytes(data)}, "finalized"); err != nil {
				return "", fmt.Errorf("rpc %d deploy time: %w", i+1, redact(err))
			}
			deployed := new(big.Int).SetBytes(out)
			if len(out) != 32 || !deployed.IsUint64() || deployed.Sign() == 0 ||
				min(t.SettleDeadline, deployed.Uint64()+30*86400) < 86400 ||
				t.ClosesAt != min(t.SettleDeadline, deployed.Uint64()+30*86400)-86400 {
				return "", fmt.Errorf("rpc %d early close disagrees with receiver deployment", i+1)
			}
		}
	}
	switch {
	case got[0] != got[1]:
		return "", fmt.Errorf("RPCs disagree: rpc 1 predicts %s, rpc 2 %s", got[0], got[1])
	case strings.ToLower(api.ReceiveAddress) != got[0]:
		return "", fmt.Errorf("api shows %s, factory predicts %s", api.ReceiveAddress, got[0])
	case page.Error != "":
		return "", fmt.Errorf("pay page: %s", page.Error)
	case len(page.Addresses) != 1 || page.Addresses[0] != got[0]:
		return "", fmt.Errorf("pay page shows %v, factory predicts %s", page.Addresses, got[0])
	case !page.QRMatches:
		return "", fmt.Errorf("pay page QR code does not encode the shown address %s", got[0])
	case !strings.Contains(page.AmountText, t.Symbol) ||
		!strings.Contains(strings.ReplaceAll(strings.ToLower(page.AmountText), " ", "-"), t.Network):
		return "", fmt.Errorf("pay page amount reads %q, want %s on %s", page.AmountText, t.Symbol, t.Network)
	}
	return got[0], nil
}

// sameTerms requires the api to show the database's terms, so predict runs on terms the api did not choose.
func sameTerms(c config.Canary, t terms, api apiInvoice) error {
	expires, err1 := time.Parse(time.RFC3339, api.ExpiresAt)
	deadline, err2 := time.Parse(time.RFC3339, api.SettleDeadline)
	for _, d := range []struct {
		name      string
		api, want any
		mismatch  bool
	}{
		{"invoiceId", api.InvoiceID, t.ID, api.InvoiceID != t.ID},
		{"chainId", api.ChainID, t.ChainID, api.ChainID != t.ChainID},
		{"recipient", api.Recipient, t.Recipient, !strings.EqualFold(api.Recipient, t.Recipient)},
		{"token", api.Token, t.Token, !strings.EqualFold(api.Token, t.Token)},
		{"amount", api.Amount, t.Amount, api.Amount != t.Amount},
		{"networkFee", api.NetworkFee, t.NetworkFee, api.NetworkFee != t.NetworkFee},
		{"platformFee", api.PlatformFee, t.PlatformFee, api.PlatformFee != t.PlatformFee},
		{"expiresAt", api.ExpiresAt, t.ExpiresAt, err1 != nil || expires.Unix() != int64(t.ExpiresAt)},
		{"settleDeadline", api.SettleDeadline, t.SettleDeadline, err2 != nil || deadline.Unix() != int64(t.SettleDeadline)},
		{"factory", api.Factory, c.Factory, !strings.EqualFold(api.Factory, c.Factory)},
	} {
		if d.mismatch {
			return fmt.Errorf("api %s %v, want %v", d.name, d.api, d.want)
		}
	}
	return nil
}

func parseTerms(line string) (terms, error) {
	f := strings.Fields(line)
	if len(f) != 13 {
		return terms{}, errors.New("want: id chain_id recipient token amount expires_at settle_deadline symbol network pay_token " +
			"closes_at network_fee platform_fee")
	}
	t := terms{ID: f[0], PayToken: f[9], Recipient: strings.ToLower(f[2]), Token: strings.ToLower(f[3]), Amount: f[4],
		Symbol: f[7], Network: f[8], NetworkFee: f[11], PlatformFee: f[12]}
	var err1, err2, err3, err4 error
	t.ChainID, err1 = strconv.ParseUint(f[1], 10, 64)
	t.ExpiresAt, err2 = strconv.ParseUint(f[5], 10, 64)
	t.SettleDeadline, err3 = strconv.ParseUint(f[6], 10, 64)
	t.ClosesAt, err4 = strconv.ParseUint(f[10], 10, 64)
	amount, ok := new(big.Int).SetString(t.Amount, 10)
	network, okNetwork := new(big.Int).SetString(t.NetworkFee, 10)
	platform, okPlatform := new(big.Int).SetString(t.PlatformFee, 10)
	if !invoiceID.MatchString(t.ID) || !payToken.MatchString(t.PayToken) || !common.IsHexAddress(t.Recipient) || !common.IsHexAddress(t.Token) || !ok ||
		amount.Sign() < 0 || amount.BitLen() > 256 || amount.String() != t.Amount || errors.Join(err1, err2, err3, err4) != nil ||
		!okNetwork || !okPlatform || network.Sign() < 0 || platform.Sign() < 0 || network.String() != t.NetworkFee ||
		platform.String() != t.PlatformFee {
		return terms{}, errors.New("a value is malformed")
	}
	// settle() takes at most a tenth of the amount in fees: past it the money could only be refunded.
	if fees := new(big.Int).Add(network, platform); new(big.Int).Mul(fees, big.NewInt(10)).Cmp(amount) > 0 {
		return terms{}, errors.New("the fees pass a tenth of the amount")
	}
	// The rules create applies: terms that break them leave a payer's money refundable only.
	switch zero := "0x0000000000000000000000000000000000000000"; {
	case amount.Sign() == 0, !slices.Contains(settleWindows, t.SettleDeadline-t.ExpiresAt), t.Recipient == zero,
		t.Recipient == t.Token, t.ClosesAt == 0, t.ClosesAt >= t.SettleDeadline:
		return terms{}, errors.New("the terms break create's rules")
	}
	return t, nil
}

// Seconds from expiry to the settle deadline that create used: 7 days (invoice.SettleWindow), 1 day before it (D-18).
var settleWindows = []uint64{604800, 86400}

// predictCall is factory.predict(terms). A factory whose terms have no fees gets none; fees on such terms are an
// alert before this is called.
func (t terms) predictCall(fees bool) []byte {
	word := func(n *big.Int) []byte { return n.FillBytes(make([]byte, 32)) }
	address := func(s string) []byte { return word(new(big.Int).SetBytes(common.HexToAddress(s).Bytes())) }
	amount, _ := new(big.Int).SetString(t.Amount, 10)
	data := append([]byte{}, predictV1...)
	if fees {
		data = append([]byte{}, predictV2...)
	}
	data = append(data, common.FromHex(t.ID)...)
	data = append(data, address(t.Recipient)...)
	data = append(data, address(t.Token)...)
	data = append(data, word(amount)...)
	data = append(data, word(new(big.Int).SetUint64(t.ExpiresAt))...)
	data = append(data, word(new(big.Int).SetUint64(t.SettleDeadline))...)
	data = append(data, word(new(big.Int).SetUint64(t.ChainID))...)
	if fees {
		network, _ := new(big.Int).SetString(t.NetworkFee, 10)
		platform, _ := new(big.Int).SetString(t.PlatformFee, 10)
		data = append(data, word(network)...)
		data = append(data, word(platform)...)
	}
	return data
}

func readAPI(ctx context.Context, link string) (apiInvoice, error) {
	var inv apiInvoice
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return inv, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return inv, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return inv, fmt.Errorf("status %d", res.StatusCode)
	}
	return inv, json.NewDecoder(res.Body).Decode(&inv)
}

// readPayPages runs the page script (apps/web/scripts/canary-pay-page.ts) once for every id: the pay page is drawn
// in the browser, and the address shows only after the payer confirms the network.
func readPayPages(ctx context.Context, c config.Canary, ids []string) (map[string]payPage, error) {
	pages := map[string]payPage{}
	if len(ids) == 0 {
		return pages, nil
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute+time.Duration(len(ids))*timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", c.PageScript, c.WebURL)
	cmd.WaitDelay = 5 * time.Second
	cmd.Stdin = strings.NewReader(strings.Join(ids, "\n"))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 500 {
			msg = "..." + msg[len(msg)-500:]
		}
		return pages, fmt.Errorf("%w: %s", err, msg)
	}
	for line := range strings.Lines(string(out)) {
		var p payPage
		if err := json.Unmarshal([]byte(line), &p); err != nil {
			return pages, fmt.Errorf("output line %q: %w", line, err)
		}
		pages[p.ID] = p
	}
	return pages, nil
}

// redact drops the URL that net/http puts in its errors: an RPC URL may hold a key.
func redact(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	var rpcErr rpc.Error
	if errors.As(err, &rpcErr) {
		return fmt.Errorf("RPC error (%d)", rpcErr.ErrorCode())
	}
	return errors.New("RPC request failed")
}
