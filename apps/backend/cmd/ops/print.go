package main

import (
	"errors"
	"fmt"
	"io"
	"math/big"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
)

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
