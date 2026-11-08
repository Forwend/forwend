package sendapi

import (
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/send"
)

// The status the app shows: a submitted send is sending until its transfer is in a block, then sent; final says the
// block can no longer change.
const (
	statusSending = "sending"
	statusSent    = "sent"
)

// How the wallet pays its network fee from the token itself (D-121): as the chain's gas coin, signed with gas caps
// (R-216), or taken by a paymaster from a Privy request the server sends (R-225). Forwend paid for sends before D-121.
const (
	paidByForwend   = "forwend"
	paidByWallet    = "wallet"
	paidByPaymaster = "paymaster"
)

type feeJSON struct {
	// In the token's base units: the most a wallet-paid send costs, the estimate a paymaster send shows.
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
	// PrivyRequest is set by approve on a paymaster send: what the user's key signs for submit.
	PrivyRequest *privy.Request `json:"privyRequest,omitempty"`
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
		CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339), PrivyRequest: s.Relay}
	if s.FeeAsset != nil {
		out.NetworkFee.PaidBy = paidByPaymaster
	}
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
