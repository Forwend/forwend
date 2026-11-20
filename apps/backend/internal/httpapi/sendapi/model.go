package sendapi

import (
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/send"
)

// A submitted send is sending until its transfer is in a block, then sent.
const (
	statusSending = "sending"
	statusSent    = "sent"
)

// Who paid a send's network fee: the wallet (gas coin, capped), a paymaster, or Forwend for old sends.
const (
	paidByForwend   = "forwend"
	paidByWallet    = "wallet"
	paidByPaymaster = "paymaster"
)

type feeJSON struct {
	Amount string `json:"amount"` // token base units; a cap for wallet-paid sends
	PaidBy string `json:"paidBy"`
}

// gasJSON is what the browser signs a wallet-paid send with, so it never costs more than networkFee.
type gasJSON struct {
	Limit                string `json:"limit"`
	MaxFeePerGas         string `json:"maxFeePerGas"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
}

type sendJSON struct {
	SendID       string         `json:"sendId"`
	ChainID      uint64         `json:"chainId"`
	Token        string         `json:"token"`
	Symbol       string         `json:"symbol"`
	Decimals     int            `json:"decimals"`
	From         string         `json:"from"`
	To           string         `json:"to"`
	ToProfileID  *string        `json:"toProfileId"`
	Amount       string         `json:"amount"`
	Status       string         `json:"status"`
	Final        bool           `json:"final"`
	TxHash       *string        `json:"txHash"`
	Failure      *string        `json:"failure"`
	NetworkFee   feeJSON        `json:"networkFee"`
	FeePaid      *string        `json:"feePaid"` // token base units; null until mined
	Gas          *gasJSON       `json:"gas"`
	Warnings     []send.Warning `json:"warnings"`
	CreatedAt    string         `json:"createdAt"`
	PrivyRequest *privy.Request `json:"privyRequest,omitempty"` // set by approve on a paymaster send
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

type prepareSendBody struct {
	ChainID     uint64 `json:"chainId"`
	Token       string `json:"token"`
	To          string `json:"to"`
	ToProfileID string `json:"toProfileId"`
	Amount      string `json:"amount"`
}
