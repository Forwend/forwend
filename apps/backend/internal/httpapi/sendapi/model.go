package sendapi

import (
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/send"
)

// The status the app shows: a submitted send is sending until its transfer is in a block, then sent; final says the
// block can no longer change.
const (
	statusSending = "sending"
	statusSent    = "sent"
)

// Who pays the network fee (D-119): Forwend where it sponsors gas, else the wallet, from the token itself (R-216).
const (
	paidByForwend = "forwend"
	paidByWallet  = "wallet"
)

type feeJSON struct {
	// The most the wallet pays, in the token's base units; 0 when Forwend pays.
	Amount string `json:"amount"`
	PaidBy string `json:"paidBy"`
}

// gasJSON is what the browser signs a wallet-paid send with, so it never costs more than networkFee.
type gasJSON struct {
	Limit                string `json:"limit"`
	MaxFeePerGas         string `json:"maxFeePerGas"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
}

type sendJSON struct {
	SendID      string  `json:"sendId"`
	ChainID     uint64  `json:"chainId"`
	Token       string  `json:"token"`
	Symbol      string  `json:"symbol"`
	Decimals    int     `json:"decimals"`
	From        string  `json:"from"`
	To          string  `json:"to"`
	ToProfileID *string `json:"toProfileId"`
	Amount      string  `json:"amount"`
	Status      string  `json:"status"`
	Final       bool    `json:"final"`
	TxHash      *string `json:"txHash"`
	Failure     *string `json:"failure"`
	NetworkFee  feeJSON `json:"networkFee"`
	// FeePaid is what the wallet really paid once mined, in the token's base units; null until known (R-224).
	FeePaid   *string        `json:"feePaid"`
	Gas       *gasJSON       `json:"gas"`
	Warnings  []send.Warning `json:"warnings"`
	CreatedAt string         `json:"createdAt"`
}

func toSendJSON(s send.Send) sendJSON {
	status := string(s.Status)
	if s.Status == send.Submitted {
		status = statusSending
		if s.OnChain {
			status = statusSent
		}
	}
	warnings := s.Warnings
	if warnings == nil {
		warnings = []send.Warning{}
	}
	out := sendJSON{SendID: s.ID, ChainID: s.ChainID, Token: s.Token, Symbol: s.Symbol, Decimals: s.Decimals, From: s.From, To: s.To, ToProfileID: s.ToProfileID,
		Amount: s.Amount.String(), Status: status, Final: s.Status == send.Sent, TxHash: s.TxHash, Failure: s.Failure,
		NetworkFee: feeJSON{Amount: s.NetworkFee.String(), PaidBy: paidByForwend}, Warnings: warnings,
		CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339)}
	if s.FeePaid != nil {
		paid := s.FeePaid.String()
		out.FeePaid = &paid
	}
	if g := s.Gas; g != nil {
		out.NetworkFee.PaidBy = paidByWallet
		out.Gas = &gasJSON{Limit: strconv.FormatUint(g.Limit, 10), MaxFeePerGas: g.MaxFeePerGas.String(),
			MaxPriorityFeePerGas: g.MaxPriorityFeePerGas.String()}
	}
	return out
}
