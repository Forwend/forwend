package sendapi

import (
	"time"

	"github.com/forwend/forwend/apps/backend/internal/send"
)

// The status the app shows: a submitted send is sending until its transfer is in a block, then sent; final says the
// block can no longer change.
const (
	statusSending = "sending"
	statusSent    = "sent"
)

type feeJSON struct {
	Amount string `json:"amount"`
	// Who pays the network fee: Forwend on every chain that offers Send (D-119).
	PaidBy string `json:"paidBy"`
}

type sendJSON struct {
	SendID      string         `json:"sendId"`
	ChainID     uint64         `json:"chainId"`
	Token       string         `json:"token"`
	Symbol      string         `json:"symbol"`
	Decimals    int            `json:"decimals"`
	From        string         `json:"from"`
	To          string         `json:"to"`
	ToProfileID *string        `json:"toProfileId"`
	Amount      string         `json:"amount"`
	Status      string         `json:"status"`
	Final       bool           `json:"final"`
	TxHash      *string        `json:"txHash"`
	Failure     *string        `json:"failure"`
	NetworkFee  feeJSON        `json:"networkFee"`
	Warnings    []send.Warning `json:"warnings"`
	CreatedAt   string         `json:"createdAt"`
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
	return sendJSON{SendID: s.ID, ChainID: s.ChainID, Token: s.Token, Symbol: s.Symbol, Decimals: s.Decimals, From: s.From, To: s.To, ToProfileID: s.ToProfileID,
		Amount: s.Amount.String(), Status: status, Final: s.Status == send.Sent, TxHash: s.TxHash, Failure: s.Failure,
		NetworkFee: feeJSON{Amount: "0", PaidBy: "forwend"}, Warnings: warnings,
		CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339)}
}
