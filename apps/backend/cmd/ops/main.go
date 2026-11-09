// Command ops is support's tool for money held for payers (PLAN 11.10.3, D-118). It reads a case, records a deposit
// the scan missed, queues a return and prints the calls for the refund authority to send; it holds no key and sends
// nothing.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
)

const usage = `usage, where <case> is a pay link, a receive address, a payment's transaction or an invoice id:
  ops case [-to <address>] <case>      (a transaction also finds another token or chain)
  ops return -tx <payment transaction> [-to <address>] [-amount <tokens>] <case>
  ops release <case>                    (a stray's transaction: only once no recover for its address waits in the Safe)
  ops deposit -tx <transaction> <case>  (records a deposit the scan missed; the ledger books it in its next round)`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "ops:", chain.Redact(err))
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New(usage)
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	tx := flags.String("tx", "", "")
	to := flags.String("to", "", "")
	amount := flags.String("amount", "", "")
	if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 1 {
		return errors.New(usage)
	}
	cfg, err := config.LoadOps()
	if err != nil {
		return err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	options, err := settlement.CaseOptions(ctx, pool, flags.Arg(0))
	// A transaction no invoice booked may be a stray transfer: case looks for it on every chain, release unlocks it.
	stray := errors.Is(err, settlement.ErrNoCase) && hashShape.MatchString(strings.TrimSpace(flags.Arg(0))) &&
		(args[0] == "case" || args[0] == "release")
	if err != nil && !stray {
		return err
	}
	var dest *common.Address
	if *to != "" && args[0] == "release" {
		return errors.New(usage)
	}
	if *to != "" && args[0] == "case" {
		if !stray {
			return errors.New("-to names a stray transfer's destination; for held money use ops return")
		}
		if !addressShape.MatchString(*to) {
			return fmt.Errorf("-to %q is not an address", *to)
		}
		a := common.HexToAddress(*to)
		dest = &a
	}
	specs, err := chain.Specs(ctx, pool, cfg.Chains.RPCSecrets, cfg.Chains.AllowLoopback)
	if err != nil {
		return err
	}
	rpcClient := func(chainID uint64) (*rpc.Client, error) {
		spec, ok := specs[chainID]
		if !ok {
			return nil, fmt.Errorf("chain %d is not enabled", chainID)
		}
		rpcs, err := chain.NewRPCs(spec, cfg.Chains.RPCRate)
		return rpcs.Client, err
	}
	client := func(chainID uint64) (*ethclient.Client, error) {
		c, err := rpcClient(chainID)
		if err != nil {
			return nil, err
		}
		return ethclient.NewClient(c), nil
	}
	every := func() (map[uint64]*ethclient.Client, error) {
		clients := map[uint64]*ethclient.Client{}
		for id := range specs {
			if clients[id], err = client(id); err != nil {
				return nil, err
			}
		}
		return clients, nil
	}

	switch args[0] {
	case "case":
		quiet := 0
		for _, o := range options {
			c, err := client(o.ChainID)
			if err != nil {
				return err
			}
			h, err := settlement.ReadHeld(ctx, pool, c, o.ID)
			if err != nil {
				return err
			}
			if len(h.Payments) == 0 && h.Held.Sign() == 0 && h.Balance.Sign() == 0 {
				quiet++
				continue
			}
			printHeld(out, h)
		}
		if quiet > 0 {
			fmt.Fprintf(out, "%d other option(s) of this invoice have no payments and hold nothing.\n", quiet)
		}
		if !stray {
			return nil
		}
		clients, err := every()
		if err != nil {
			return err
		}
		strays, err := settlement.FindStrays(ctx, pool, clients, strings.TrimSpace(flags.Arg(0)))
		if err != nil {
			return err
		}
		if len(strays) == 0 {
			return settlement.ErrNoCase
		}
		if dest != nil && len(strays) > 1 {
			return errors.New("-to: this transaction made several stray transfers; run without -to")
		}
		for _, st := range strays {
			home, ok := clients[st.Option.ChainID]
			if !ok {
				return fmt.Errorf("chain %d is not enabled", st.Option.ChainID)
			}
			r, err := settlement.PlanRecovery(ctx, pool, home, clients[st.ChainID], st, dest)
			if err != nil && !errors.Is(err, settlement.ErrCantReturn) && !errors.Is(err, settlement.ErrRecoveryQueued) &&
				!errors.Is(err, settlement.ErrDestination) && !errors.Is(err, settlement.ErrNotFinal) {
				return err
			}
			printStray(out, st, r, err)
		}
		return nil
	case "return":
		if *tx == "" {
			return errors.New(usage)
		}
		// The option is this case's one the payment went to; one transaction can pay several invoices.
		touched, err := settlement.CaseOptions(ctx, pool, *tx)
		if err != nil && !errors.Is(err, settlement.ErrNoCase) {
			return err
		}
		var paid []settlement.CaseOption
		for _, o := range touched {
			if contains(options, o) {
				paid = append(paid, o)
			}
		}
		if len(paid) != 1 {
			return settlement.ErrUnknownPayment
		}
		c, err := client(paid[0].ChainID)
		if err != nil {
			return err
		}
		h, err := settlement.ReadHeld(ctx, pool, c, paid[0].ID)
		if err != nil {
			return err
		}
		var dest *common.Address
		if *to != "" {
			if !addressShape.MatchString(*to) {
				return fmt.Errorf("-to %q is not an address", *to)
			}
			a := common.HexToAddress(*to)
			dest = &a
		}
		var units *big.Int
		if *amount != "" {
			if units, err = baseUnits(*amount, h.Decimals); err != nil {
				return err
			}
		}
		r, err := settlement.QueueReturn(ctx, pool, c, paid[0].ID, *tx, dest, units)
		if err != nil {
			return err
		}
		printReturn(out, h, r, flags.Arg(0))
		return nil
	case "release":
		if stray {
			clients, err := every()
			if err != nil {
				return err
			}
			n, err := settlement.ReleaseRecovery(ctx, pool, clients, flags.Arg(0))
			if n > 0 {
				fmt.Fprintf(out, "Released %d printed recover(s) of that transaction.\n", n)
			}
			return err
		}
		released := 0
		for _, o := range options {
			switch err := settlement.ReleaseReturn(ctx, pool, o.ID); {
			case err == nil:
				released++
				fmt.Fprintf(out, "Released the return queued for %s. Its money is held for the payer again.\n", o.ID)
			case !errors.Is(err, settlement.ErrNoReturnQueued):
				return err
			}
		}
		if released == 0 {
			return settlement.ErrNoReturnQueued
		}
		return nil
	case "deposit":
		if !hashShape.MatchString(*tx) || *to != "" || *amount != "" {
			return errors.New(usage)
		}
		byChain := map[uint64][]string{}
		for _, o := range options {
			byChain[o.ChainID] = append(byChain[o.ChainID], o.ID)
		}
		found := false
		for chainID, ids := range byChain {
			c, err := rpcClient(chainID)
			if err != nil {
				return err
			}
			n, err := watcher.NewChain(pool, chainID, c).RecordDeposits(ctx, common.HexToHash(*tx), ids)
			if errors.Is(err, watcher.ErrNoDeposit) {
				continue
			}
			if err != nil {
				return err
			}
			found = true
			if n == 0 {
				fmt.Fprintf(out, "Chain %d: its deposits are already recorded. Nothing new.\n", chainID)
				continue
			}
			fmt.Fprintf(out, "Chain %d: recorded %d deposit(s). The ledger books them in its next round; "+
				"then ops case shows them and ops return returns them.\n", chainID, n)
		}
		if !found {
			return watcher.ErrNoDeposit
		}
		return nil
	}
	return errors.New(usage)
}

var (
	addressShape = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	hashShape    = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
	decimalShape = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)
)

// baseUnits reads "1.50" as the token's base units, exactly.
func baseUnits(text string, decimals int) (*big.Int, error) {
	r, ok := new(big.Rat).SetString(text)
	if !decimalShape.MatchString(text) || !ok || r.Sign() <= 0 {
		return nil, fmt.Errorf("-amount %q is not a positive number of tokens", text)
	}
	r.Mul(r, new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)))
	if !r.IsInt() {
		return nil, fmt.Errorf("-amount %q has more than %d decimals", text, decimals)
	}
	return r.Num(), nil
}

func contains(options []settlement.CaseOption, o settlement.CaseOption) bool {
	for _, x := range options {
		if x == o {
			return true
		}
	}
	return false
}

func printHeld(out io.Writer, h settlement.Held) {
	money := func(n *big.Int) string { return document.Amount(n, h.Decimals, h.Symbol) }
	fmt.Fprintf(out, "Invoice option %s on chain %d\n", h.InvoiceID, h.ChainID)
	fmt.Fprintf(out, "  Receive address: %s (token %s)\n", h.Receive, h.Token)
	fmt.Fprintf(out, "  Status: %s; refund: %s\n", h.PaymentStatus, h.RefundStatus)
	reasons := ""
	if len(h.Reasons) > 0 {
		reasons = " (" + strings.Join(h.Reasons, ", ") + ")"
	}
	fmt.Fprintf(out, "  Held for the payer: %s%s\n", money(h.Held), reasons)
	fmt.Fprintln(out, "  Payments:")
	for _, p := range h.Payments {
		fmt.Fprintf(out, "    %s from %s: %s, %s\n", p.TxHash, p.From, money(p.Amount),
			time.Unix(p.BlockTime, 0).UTC().Format("2 Jan 2006, 15:04 UTC"))
		if p.Quote != "" {
			fmt.Fprintf(out, "      Sent by NEAR Intents, not the payer: quote %s; the payer paid on %s in %s, refund address "+
				"there %s.\n      Return it only with -to, an address on chain %d the payer proves is theirs.\n",
				p.Quote, p.OriginChain, p.OriginTx, p.RefundTo, h.ChainID)
		} else if p.Relayed {
			fmt.Fprintf(out, "      Sent by NEAR Intents, not the payer; no quote names it yet.\n      Return it only "+
				"with -to, an address on chain %d the payer proves is theirs.\n", h.ChainID)
		}
	}
	deployed := "not deployed"
	if h.Deployed {
		deployed = "deployed"
	}
	fmt.Fprintf(out, "  Receiver: %s; balance %s; refundable now %s\n", deployed, money(h.Balance), money(h.Refundable))
	if !h.Settled {
		fmt.Fprintf(out, "  All of it is refundable after %s.\n", h.Deadline.Format("2 Jan 2006, 15:04 UTC"))
	}
	fmt.Fprintf(out, "  Refund authority: %s\n\n", h.Authority.Hex())
}

func printStray(out io.Writer, s settlement.Stray, r settlement.Recovery, cant error) {
	money := s.Amount.String() + " base units of token " + s.Token.Hex()
	if s.Symbol != "" {
		money = document.Amount(s.Amount, s.Decimals, s.Symbol) + " (" + s.Token.Hex() + ")"
	}
	fmt.Fprintf(out, "Transfer %s on chain %d: %s from %s\n", s.TxHash, s.ChainID, money, s.From.Hex())
	fmt.Fprintf(out, "  It went to invoice option %s on chain %d, which doesn't take it.\n", s.Option.ID, s.Option.ChainID)
	if errors.Is(cant, settlement.ErrRecoveryQueued) {
		fmt.Fprintf(out, "  %s: send it if it isn't yet. If it never will be, reject or execute every recover "+
			"queued for this address in the Safe, then ops release %s.\n\n", cant, s.TxHash)
		return
	}
	if errors.Is(cant, settlement.ErrNotFinal) {
		fmt.Fprintf(out, "  %s.\n\n", cant)
		return
	}
	if errors.Is(cant, settlement.ErrDestination) {
		fmt.Fprintf(out, "  %s: give another with -to.\n\n", cant)
		return
	}
	if cant != nil {
		fmt.Fprintf(out, "  %s. Tell the payer plainly; promise nothing (D-33).\n\n", cant)
		return
	}
	for _, w := range r.Warnings {
		fmt.Fprintln(out, "  Warning:", w)
	}
	fmt.Fprintf(out, "  Send from the refund authority %s on chain %d, in this order (in a Safe: Transaction Builder, custom data):\n",
		r.Authority.Hex(), s.ChainID)
	for i, c := range r.Calls {
		fmt.Fprintf(out, "    %d. To   %s\n       Data 0x%x\n", i+1, c.To.Hex(), c.Data)
	}
	fmt.Fprintln(out, "  Or from a testnet authority's own wallet with Foundry (add --rpc-url and the signer):")
	for _, c := range r.Calls {
		fmt.Fprintf(out, "    cast send %s '%s' '%s'\n", c.To.Hex(), c.Signature, strings.Join(c.Args, "' '"))
	}
	fmt.Fprintln(out)
}

func printReturn(out io.Writer, h settlement.Held, r settlement.Return, ref string) {
	fmt.Fprintf(out, "Queued: %s to %s on chain %d.\n", document.Amount(r.Amount, h.Decimals, h.Symbol), r.To.Hex(), h.ChainID)
	fmt.Fprintf(out, "The money stays locked until this refund lands. If it won't be sent: ops release %s\n", ref)
	for _, w := range r.Warnings {
		fmt.Fprintln(out, "Warning:", w)
	}
	fmt.Fprintf(out, "\nSend from the refund authority %s, in this order (in a Safe: Transaction Builder, custom data):\n",
		h.Authority.Hex())
	for i, c := range r.Calls {
		fmt.Fprintf(out, "  %d. To   %s\n     Data 0x%x\n", i+1, c.To.Hex(), c.Data)
	}
	fmt.Fprintln(out, "\nOr from a testnet authority's own wallet with Foundry (add --rpc-url and the signer):")
	for _, c := range r.Calls {
		fmt.Fprintf(out, "  cast send %s '%s' '%s'\n", c.To.Hex(), c.Signature, strings.Join(c.Args, "' '"))
	}
}
