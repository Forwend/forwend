package moneyapi

import (
	"math/big"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
)

type tokenJSON struct {
	ChainID  uint64 `json:"chainId"`
	Token    string `json:"token"`
	Symbol   string `json:"symbol"`
	Decimals int    `json:"decimals"`
}

func toTokenJSON(a chain.Asset) tokenJSON {
	return tokenJSON{ChainID: a.ChainID, Token: a.Token, Symbol: a.Symbol, Decimals: a.Decimals}
}

type balancesJSON struct {
	Tokens            []tokenBalanceJSON `json:"tokens"`
	EstimatedUSDTotal *string            `json:"estimatedUsdTotal"`
}

type tokenBalanceJSON struct {
	tokenJSON
	Wallet         *string `json:"wallet"`
	FinalizedBlock *uint64 `json:"finalizedBlock"`
	Pending        string  `json:"pending"`
	Held           string  `json:"held"`
}

type activityJSON struct {
	Items      []activityItemJSON `json:"items"`
	NextCursor *string            `json:"nextCursor"`
}

type activityItemJSON struct {
	Kind      string `json:"kind"`
	At        string `json:"at"`
	InvoiceID string `json:"invoiceId"`
	tokenJSON
	Amount           string `json:"amount"`
	Status           string `json:"status"`
	SettlementStatus string `json:"settlementStatus,omitempty"`
	TxHash           string `json:"txHash,omitempty"`
	OptionCount      int    `json:"optionCount"`
	Closed           bool   `json:"closed"`
	Held             bool   `json:"held"`
}

type transactionsJSON struct {
	Items      []transactionJSON `json:"items"`
	NextCursor *string           `json:"nextCursor"`
}

type transactionJSON struct {
	tokenJSON
	Direction      string                  `json:"direction"`
	Amount         string                  `json:"amount"`
	Counterparty   string                  `json:"counterparty"`
	TxHash         string                  `json:"txHash"`
	LogIndex       uint64                  `json:"logIndex"`
	BlockNumber    uint64                  `json:"blockNumber"`
	At             string                  `json:"at"`
	Status         string                  `json:"status"`
	UsdValue       string                  `json:"usdValue"`
	Classification string                  `json:"classification"`
	Labelable      bool                    `json:"labelable"`
	Invoice        *transactionInvoiceJSON `json:"invoice"`
}

// transactionInvoiceJSON is the invoice money in paid (R-108); clientName is null when it has none.
type transactionInvoiceJSON struct {
	InvoiceID  string  `json:"invoiceId"`
	Number     int64   `json:"number"`
	ClientName *string `json:"clientName"`
}

func toTransactionJSON(t activity.Transfer) transactionJSON {
	out := transactionJSON{tokenJSON: toTokenJSON(t.Asset), Direction: t.Direction, Amount: t.Amount.String(),
		Counterparty: t.Counterparty, TxHash: t.TxHash, LogIndex: t.LogIndex, BlockNumber: t.BlockNumber,
		At: t.At.Format(time.RFC3339), Status: t.Status, UsdValue: t.USDValue().FloatString(t.Decimals),
		Classification: t.Classification(), Labelable: t.Labelable()}
	if i := t.Invoice; i != nil {
		out.Invoice = &transactionInvoiceJSON{InvoiceID: i.ID, Number: i.Number, ClientName: httpio.OrNull(i.ClientName)}
	}
	return out
}

// tokenAmount is the amount in the token's units, with every decimal.
func tokenAmount(t activity.Transfer) string {
	return new(big.Rat).SetFrac(t.Amount, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(t.Decimals)), nil)).
		FloatString(t.Decimals)
}

type balanceHistoryJSON struct {
	Points []historyPointJSON `json:"points"`
	Tokens []tokenHistoryJSON `json:"tokens"`
}

type historyPointJSON struct {
	At           string  `json:"at"`
	EstimatedUSD *string `json:"estimatedUsd"`
	ReceivedUSD  *string `json:"receivedUsd"`
	SentUSD      *string `json:"sentUsd"`
}

type tokenHistoryJSON struct {
	tokenJSON
	Balances []string `json:"balances"`
	Received []string `json:"received"`
	Sent     []string `json:"sent"`
}

// baseUnits writes amounts as decimal strings; nil stays nil (JSON null).
func baseUnits(amounts []*big.Int) []string {
	if amounts == nil {
		return nil
	}
	out := make([]string, len(amounts))
	for i, a := range amounts {
		out[i] = a.String()
	}
	return out
}
