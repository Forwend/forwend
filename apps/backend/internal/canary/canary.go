// Package canary checks invoices' receive addresses apart from the code that makes them (R-51). It must not import
// internal/address, internal/invoice or anything else holding the factory address: a tampered constant there would
// fool it too. TestImportsNoAppCode keeps it that way.
package canary

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/config"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rpc"
)

const timeout = 30 * time.Second

var (
	invoiceID = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
	predict   = crypto.Keccak256([]byte("predict((bytes32,address,address,uint256,uint64,uint64,uint256))"))[:4]
)

// terms is one stdin line, as the database holds the invoice:
// id chain_id recipient_address token_contract amount expires_at settle_deadline.
type terms struct {
	ID, Recipient, Token, Amount, Symbol, Network string
	ChainID, ExpiresAt, SettleDeadline            uint64
}

// apiInvoice is the part of GET /v1/invoices/{id} the canary compares.
type apiInvoice struct {
	InvoiceID, Recipient, Token, Amount, ExpiresAt, SettleDeadline, Factory, ReceiveAddress string
	ChainID                                                                                 uint64
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
			cl, err := rpc.DialContext(ctx, u)
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
	for _, line := range lines {
		t, err := parseTerms(line)
		if err != nil {
			alerts = append(alerts, fmt.Sprintf("input line %q: %v", line, err))
			continue
		}
		invoices = append(invoices, t)
		ids = append(ids, t.ID)
	}
	pages, err := readPayPages(ctx, c, ids)
	if err != nil {
		alerts = append(alerts, fmt.Sprintf("pay page script: %v", err))
	}
	for _, t := range invoices {
		page, ok := pages[t.ID]
		if !ok {
			page.Error = "no result from the page script"
		}
		ictx, cancel := context.WithTimeout(ctx, timeout)
		if err := checkInvoice(ictx, c, rpcs, t, page); err != nil {
			alerts = append(alerts, fmt.Sprintf("invoice %s: %v", t.ID, err))
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

func checkInvoice(ctx context.Context, c config.Canary, rpcs map[uint64][2]*rpc.Client, t terms, page payPage) error {
	api, err := readAPI(ctx, c.APIURL+"/v1/invoices/"+t.ID)
	if err != nil {
		return fmt.Errorf("api: %w", err)
	}
	if err := sameTerms(c, t, api); err != nil {
		return err
	}
	pair, ok := rpcs[t.ChainID]
	if !ok {
		return fmt.Errorf("no RPCs configured for chain %d", t.ChainID)
	}
	var got [2]string
	for i, cl := range pair {
		if cl == nil {
			return fmt.Errorf("rpc %d unavailable", i+1)
		}
		var out hexutil.Bytes
		err := cl.CallContext(ctx, &out, "eth_call", map[string]any{"to": c.Factory, "data": hexutil.Bytes(t.predictCall())},
			"latest")
		if err != nil {
			return fmt.Errorf("rpc %d predict: %w", i+1, redact(err))
		}
		if len(out) != 32 {
			return fmt.Errorf("rpc %d predict: %d bytes, want 32", i+1, len(out))
		}
		got[i] = strings.ToLower(common.BytesToAddress(out).Hex())
	}
	switch {
	case got[0] != got[1]:
		return fmt.Errorf("RPCs disagree: rpc 1 predicts %s, rpc 2 %s", got[0], got[1])
	case strings.ToLower(api.ReceiveAddress) != got[0]:
		return fmt.Errorf("api shows %s, factory predicts %s", api.ReceiveAddress, got[0])
	case page.Error != "":
		return fmt.Errorf("pay page: %s", page.Error)
	case len(page.Addresses) != 1 || page.Addresses[0] != got[0]:
		return fmt.Errorf("pay page shows %v, factory predicts %s", page.Addresses, got[0])
	case !page.QRMatches:
		return fmt.Errorf("pay page QR code does not encode the shown address %s", got[0])
	case !strings.Contains(page.AmountText, t.Symbol) ||
		!strings.Contains(strings.ReplaceAll(strings.ToLower(page.AmountText), " ", "-"), t.Network):
		return fmt.Errorf("pay page amount reads %q, want %s on %s", page.AmountText, t.Symbol, t.Network)
	}
	return nil
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
	if len(f) != 9 {
		return terms{}, errors.New("want: id chain_id recipient token amount expires_at settle_deadline symbol network")
	}
	t := terms{ID: f[0], Recipient: strings.ToLower(f[2]), Token: strings.ToLower(f[3]), Amount: f[4], Symbol: f[7],
		Network: f[8]}
	var err1, err2, err3 error
	t.ChainID, err1 = strconv.ParseUint(f[1], 10, 64)
	t.ExpiresAt, err2 = strconv.ParseUint(f[5], 10, 64)
	t.SettleDeadline, err3 = strconv.ParseUint(f[6], 10, 64)
	amount, ok := new(big.Int).SetString(t.Amount, 10)
	if !invoiceID.MatchString(t.ID) || !common.IsHexAddress(t.Recipient) || !common.IsHexAddress(t.Token) || !ok ||
		amount.Sign() < 0 || amount.BitLen() > 256 || amount.String() != t.Amount || errors.Join(err1, err2, err3) != nil {
		return terms{}, errors.New("a value is malformed")
	}
	// The rules create applies: terms that break them leave a payer's money refundable only.
	switch zero := "0x0000000000000000000000000000000000000000"; {
	case amount.Sign() == 0, t.SettleDeadline != t.ExpiresAt+86400, t.Recipient == zero, t.Recipient == t.Token:
		return terms{}, errors.New("the terms break create's rules")
	}
	return t, nil
}

// predictCall is the calldata of factory.predict(InvoiceTerms): seven static ABI words.
func (t terms) predictCall() []byte {
	word := func(n *big.Int) []byte { return n.FillBytes(make([]byte, 32)) }
	address := func(s string) []byte { return word(new(big.Int).SetBytes(common.HexToAddress(s).Bytes())) }
	amount, _ := new(big.Int).SetString(t.Amount, 10)
	data := append([]byte{}, predict...)
	data = append(data, common.FromHex(t.ID)...)
	data = append(data, address(t.Recipient)...)
	data = append(data, address(t.Token)...)
	data = append(data, word(amount)...)
	data = append(data, word(new(big.Int).SetUint64(t.ExpiresAt))...)
	data = append(data, word(new(big.Int).SetUint64(t.SettleDeadline))...)
	data = append(data, word(new(big.Int).SetUint64(t.ChainID))...)
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
	var u *url.Error
	if errors.As(err, &u) {
		return u.Err
	}
	return err
}
