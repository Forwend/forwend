package moneyapi

import (
	"math/big"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
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
	Direction    string `json:"direction"`
	Amount       string `json:"amount"`
	Counterparty string `json:"counterparty"`
	TxHash       string `json:"txHash"`
	LogIndex     uint64 `json:"logIndex"`
	BlockNumber  uint64 `json:"blockNumber"`
	At           string `json:"at"`
	Status       string `json:"status"`
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
