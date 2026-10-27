package paymentio

import (
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type Deposit struct {
	TxHash      string  `json:"txHash"`
	LogIndex    uint64  `json:"logIndex"`
	From        string  `json:"from"`
	Amount      string  `json:"amount"`
	BlockNumber uint64  `json:"blockNumber"`
	BlockTime   string  `json:"blockTime"`
	Status      string  `json:"status"`
	Late        bool    `json:"late"`
	Paid        *string `json:"paid"` // the part booked to the creator (R-121); null until the ledger books it
	BlocksLeft  uint64  `json:"blocksLeft"`
	BlocksTotal uint64  `json:"blocksTotal"`
	SecondsLeft int64   `json:"secondsLeft"`
}

func Deposits(deposits []invoice.Deposit) []Deposit {
	out := []Deposit{}
	for _, d := range deposits {
		dj := Deposit{TxHash: d.TxHash, LogIndex: d.LogIndex, From: d.From,
			Amount: d.Amount.String(), BlockNumber: d.BlockNumber, BlockTime: d.BlockTime.Format(time.RFC3339),
			Status: d.Status, Late: d.Late, BlocksLeft: d.BlocksLeft, BlocksTotal: d.BlocksTotal, SecondsLeft: int64(d.TimeLeft / time.Second)}
		if d.Paid != nil {
			dj.Paid = httpio.OrNull(d.Paid.String())
		}
		out = append(out, dj)
	}
	return out
}
