// Command ops is support's tool for money held for payers (PLAN 11.10.3, D-118). It reads a case, queues a return
// and prints the calls for the refund authority to send; it holds no key and sends nothing.
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
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
)

const usage = `usage, where <case> is a pay link, a receive address, a payment's transaction or an invoice id:
  ops case <case>
  ops return -tx <payment transaction> [-to <address>] [-amount <tokens>] <case>
  ops release <case>`

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
	if err != nil {
		return err
	}
	specs, err := chain.Specs(ctx, pool, cfg.Chains.RPCSecrets, cfg.Chains.AllowLoopback)
	if err != nil {
		return err
	}
	client := func(chainID uint64) (*ethclient.Client, error) {
		spec, ok := specs[chainID]
		if !ok {
			return nil, fmt.Errorf("chain %d is not enabled", chainID)
		}
		rpcs, err := chain.NewRPCs(spec, cfg.Chains.RPCRate)
		if err != nil {
			return nil, err
		}
		return ethclient.NewClient(rpcs.Client), nil
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
	}
	return errors.New(usage)
}

var (
	addressShape = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
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
