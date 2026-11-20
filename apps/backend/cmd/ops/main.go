// Command ops is support's tool for money held for payers; it holds no key and sends nothing.
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
	"os/user"
	"regexp"
	"slices"
	"strings"
	"syscall"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
	"github.com/jackc/pgx/v5/pgxpool"
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
	ref := flags.Arg(0)
	cfg, err := config.LoadOps()
	if err != nil {
		return err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	// Log who ran what before anything changes: the OS user names the operator.
	who, err := user.Current()
	if err != nil {
		return fmt.Errorf("read who runs ops: %w", err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO ops_runs (operator, args) VALUES ($1, $2)", who.Username, args); err != nil {
		return fmt.Errorf("record this run: %w", err)
	}
	options, err := settlement.CaseOptions(ctx, pool, ref)
	stray := errors.Is(err, settlement.ErrNoCase) && hashShape.MatchString(strings.TrimSpace(ref)) &&
		(args[0] == "case" || args[0] == "release")
	if err != nil && !stray {
		return err
	}
	specs, err := chain.Specs(ctx, pool, cfg.Chains.RPCSecrets, cfg.Chains.AllowLoopback)
	if err != nil {
		return err
	}
	chains := rpcs{specs: specs, rate: cfg.Chains.RPCRate}

	switch args[0] {
	case "case":
		if *to != "" && !stray {
			return errors.New("-to names a stray transfer's destination; for held money use ops return")
		}
		dest, err := toAddress(*to)
		if err != nil {
			return err
		}
		return showCase(ctx, pool, chains, out, options, stray, ref, dest)
	case "return":
		if *tx == "" {
			return errors.New(usage)
		}
		dest, err := toAddress(*to)
		if err != nil {
			return err
		}
		return queueReturn(ctx, pool, chains, out, options, ref, *tx, dest, *amount)
	case "release":
		if *to != "" {
			return errors.New(usage)
		}
		return release(ctx, pool, chains, out, options, stray, ref)
	case "deposit":
		if !hashShape.MatchString(*tx) || *to != "" || *amount != "" {
			return errors.New(usage)
		}
		return recordDeposits(ctx, pool, chains, out, options, *tx)
	}
	return errors.New(usage)
}

func showCase(ctx context.Context, pool *pgxpool.Pool, chains rpcs, out io.Writer, options []settlement.CaseOption,
	stray bool, ref string, dest *common.Address) error {
	quiet := 0
	for _, o := range options {
		c, err := chains.client(o.ChainID)
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
	clients, err := chains.all()
	if err != nil {
		return err
	}
	strays, err := settlement.FindStrays(ctx, pool, clients, strings.TrimSpace(ref))
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
}

func queueReturn(ctx context.Context, pool *pgxpool.Pool, chains rpcs, out io.Writer, options []settlement.CaseOption,
	ref, tx string, dest *common.Address, amount string) error {
	// One transaction can pay several invoices: the option is this case's one the payment went to.
	touched, err := settlement.CaseOptions(ctx, pool, tx)
	if err != nil && !errors.Is(err, settlement.ErrNoCase) {
		return err
	}
	var paid []settlement.CaseOption
	for _, o := range touched {
		if slices.Contains(options, o) {
			paid = append(paid, o)
		}
	}
	if len(paid) != 1 {
		return settlement.ErrUnknownPayment
	}
	c, err := chains.client(paid[0].ChainID)
	if err != nil {
		return err
	}
	h, err := settlement.ReadHeld(ctx, pool, c, paid[0].ID)
	if err != nil {
		return err
	}
	var units *big.Int
	if amount != "" {
		if units, err = baseUnits(amount, h.Decimals); err != nil {
			return err
		}
	}
	r, err := settlement.QueueReturn(ctx, pool, c, paid[0].ID, tx, dest, units)
	if err != nil {
		return err
	}
	printReturn(out, h, r, ref)
	return nil
}

func release(ctx context.Context, pool *pgxpool.Pool, chains rpcs, out io.Writer, options []settlement.CaseOption,
	stray bool, ref string) error {
	if stray {
		clients, err := chains.all()
		if err != nil {
			return err
		}
		n, err := settlement.ReleaseRecovery(ctx, pool, clients, ref)
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
}

func recordDeposits(ctx context.Context, pool *pgxpool.Pool, chains rpcs, out io.Writer, options []settlement.CaseOption,
	tx string) error {
	byChain := map[uint64][]string{}
	for _, o := range options {
		byChain[o.ChainID] = append(byChain[o.ChainID], o.ID)
	}
	found := false
	for chainID, ids := range byChain {
		c, err := chains.raw(chainID)
		if err != nil {
			return err
		}
		n, err := watcher.NewChain(pool, chainID, c).RecordDeposits(ctx, common.HexToHash(tx), ids)
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

type rpcs struct {
	specs map[uint64]chain.Spec
	rate  float64
}

func (r rpcs) raw(chainID uint64) (*rpc.Client, error) {
	spec, ok := r.specs[chainID]
	if !ok {
		return nil, fmt.Errorf("chain %d is not enabled", chainID)
	}
	pool, err := chain.NewRPCs(spec, r.rate, nil)
	return pool.Client, err
}

func (r rpcs) client(chainID uint64) (*ethclient.Client, error) {
	c, err := r.raw(chainID)
	if err != nil {
		return nil, err
	}
	return ethclient.NewClient(c), nil
}

func (r rpcs) all() (map[uint64]*ethclient.Client, error) {
	clients := map[uint64]*ethclient.Client{}
	for id := range r.specs {
		c, err := r.client(id)
		if err != nil {
			return nil, err
		}
		clients[id] = c
	}
	return clients, nil
}

var (
	addressShape = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	hashShape    = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
	decimalShape = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)
)

func toAddress(flag string) (*common.Address, error) {
	if flag == "" {
		return nil, nil
	}
	if !addressShape.MatchString(flag) {
		return nil, fmt.Errorf("-to %q is not an address", flag)
	}
	a := common.HexToAddress(flag)
	return &a, nil
}

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
