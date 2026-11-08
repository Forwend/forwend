package moneyapi

import (
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
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
	Livemode       bool    `json:"livemode"`
	Sendable       bool    `json:"sendable"`
	Wallet         *string `json:"wallet"`
	FinalizedBlock *uint64 `json:"finalizedBlock"`
	Pending        string  `json:"pending"`
	Settling       string  `json:"settling"`
	Confirming     string  `json:"confirming"`
	Partial        string  `json:"partial"`
	Held           string  `json:"held"`
}

type activityJSON struct {
	Items      []activityItemJSON `json:"items"`
	NextCursor *string            `json:"nextCursor"`
}

type activityItemJSON struct {
	PaymentStatus string `json:"paymentStatus"`
	Confirming    bool   `json:"confirming"`
	Kind          string `json:"kind"`
	At            string `json:"at"`
	InvoiceID     string `json:"invoiceId"`
	tokenJSON
	Amount           string `json:"amount"`
	Status           string `json:"status"`
	SettlementStatus string `json:"settlementStatus,omitempty"`
	TxHash           string `json:"txHash,omitempty"`
	OptionCount      int    `json:"optionCount"`
	Closed           bool   `json:"closed"`
	Held             bool   `json:"held"`
	// D-114: a booked deposit's parts; D-107: what names the payment.
	MerchantAmount *string              `json:"merchantAmount"`
	HeldAmount     *string              `json:"heldAmount"`
	Purpose        invoice.Purpose      `json:"purpose"`
	DocumentKind   invoice.DocumentKind `json:"documentKind"`
	Number         *int64               `json:"number"`
	Reference      *string              `json:"reference"`
	ClientName     *string              `json:"clientName"`
	Title          *string              `json:"title"`
}

func optionalAmount(amount *big.Int) *string {
	if amount == nil {
		return nil
	}
	value := amount.String()
	return &value
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
	Payment        *transactionPaymentJSON `json:"payment,omitempty"`
	Invoice        *transactionInvoiceJSON `json:"invoice"`
	RecordsValue   *recordsValueJSON       `json:"recordsValue"`
	// FeePaid is the gas the wallet paid for the send, in the token's base units; null when not a known send (R-224).
	FeePaid *string `json:"feePaid"`
}

// R-110: at the ECB rate of RateDate.
type recordsValueJSON struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
	RateDate string `json:"rateDate"`
}

type transactionPaymentJSON struct {
	PaymentID       string               `json:"paymentId"`
	Purpose         invoice.Purpose      `json:"purpose"`
	DocumentKind    invoice.DocumentKind `json:"documentKind"`
	PolicyException *string              `json:"policyException"`
	Unreconciled    bool                 `json:"unreconciled"`
	// What the settlement paid out of the payment before the rest reached the wallet; null when none (R-228).
	Fees *string `json:"fees"`
}

// R-108.
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
	if p := t.Payment; p != nil {
		out.Payment = &transactionPaymentJSON{PaymentID: p.ID, Purpose: p.Purpose, DocumentKind: p.DocumentKind,
			PolicyException: httpio.OrNull(p.PolicyException), Unreconciled: p.Unreconciled}
		if p.Fees != nil {
			fees := p.Fees.String()
			out.Payment.Fees = &fees
		}
	}
	if i := t.Invoice; i != nil {
		out.Invoice = &transactionInvoiceJSON{InvoiceID: i.ID, Number: i.Number, ClientName: httpio.OrNull(i.ClientName)}
	}
	if amount, day, ok := t.RecordsValue(); ok {
		out.RecordsValue = &recordsValueJSON{Currency: t.RecordsCurrency, Amount: amount, RateDate: day.Format(time.DateOnly)}
	}
	if t.FeePaid != nil {
		paid := t.FeePaid.String()
		out.FeePaid = &paid
	}
	return out
}

func tokenAmount(t activity.Transfer) string {
	return units(t.Amount, t.Decimals)
}

func units(n *big.Int, decimals int) string {
	return new(big.Rat).SetFrac(n, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)).FloatString(decimals)
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
	Livemode bool     `json:"livemode"`
	Balances []string `json:"balances"`
	Received []string `json:"received"`
	Sent     []string `json:"sent"`
}

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
