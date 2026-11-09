package paymentapi

import (
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type movementJSON struct {
	Livemode            bool                  `json:"livemode"`
	Network             string                `json:"network"`
	ID                  string                `json:"id"`
	State               string                `json:"state"`
	RecordedAt          string                `json:"recordedAt"`
	PaymentID           string                `json:"paymentId"`
	OptionID            string                `json:"optionId"`
	StoreID             *string               `json:"storeId"`
	StoreName           *string               `json:"storeName"`
	Source              invoice.PaymentSource `json:"source"`
	DocumentKind        invoice.DocumentKind  `json:"documentKind"`
	Number              *int64                `json:"number"`
	Reference           *string               `json:"reference"`
	Title               *string               `json:"title"`
	ChainID             uint64                `json:"chainId"`
	Token               string                `json:"token"`
	Symbol              *string               `json:"symbol"`
	Decimals            *int                  `json:"decimals"`
	Kind                string                `json:"kind"`
	SourceAmount        *string               `json:"sourceAmount"`
	BookedAmount        *string               `json:"bookedAmount"`
	ReceiverDelta       *string               `json:"receiverDelta"`
	PayableDelta        *string               `json:"payableDelta"`
	HeldDelta           *string               `json:"heldDelta"`
	ReceiverUSDDelta    *string               `json:"receiverUsdDelta"`
	TxHash              *string               `json:"txHash"`
	LogIndex            *uint64               `json:"logIndex"`
	TransferLogIndex    *uint64               `json:"transferLogIndex"`
	BlockHash           *string               `json:"blockHash"`
	BlockNumber         *uint64               `json:"blockNumber"`
	BlockTime           *string               `json:"blockTime"`
	From                *string               `json:"from"`
	To                  *string               `json:"to"`
	Status              string                `json:"status"`
	Verified            bool                  `json:"verified"`
	VerifiedBlock       *uint64               `json:"verifiedBlock"`
	VerifiedHash        *string               `json:"verifiedHash"`
	PolicyException     *string               `json:"policyException"`
	ReconciliationError *string               `json:"reconciliationError"`
	// R-235: what the payer sent through NEAR Intents for this Base transfer; null for any other row.
	PaidWith *paidWithJSON `json:"paidWith"`
}

type paidWithJSON struct {
	Provider   string  `json:"provider"`
	Symbol     string  `json:"symbol"`
	Blockchain string  `json:"blockchain"`
	Decimals   int     `json:"decimals"`
	Amount     string  `json:"amount"`
	TxHash     *string `json:"txHash"`
}

func toMovement(row invoice.PaymentMovement) movementJSON {
	var usd *string
	if row.ReceiverDelta != nil && row.Decimals != nil {
		value := invoice.PaymentUSDValue(row.ReceiverDelta, *row.Decimals)
		usd = &value
	}
	return movementJSON{Livemode: row.Livemode, Network: row.Network, ID: row.ID, State: row.State, RecordedAt: row.RecordedAt.UTC().Format(time.RFC3339Nano), PaymentID: row.PaymentID, OptionID: row.OptionID,
		StoreID: httpio.OrNull(row.StoreID), StoreName: httpio.OrNull(row.StoreName), Source: row.Source, DocumentKind: row.DocumentKind, Number: row.Number,
		Reference: httpio.OrNull(row.Reference), Title: httpio.OrNull(row.Title), ChainID: row.ChainID, Token: row.Token, Symbol: httpio.OrNull(row.Symbol), Decimals: row.Decimals,
		Kind: row.Kind, SourceAmount: optionalAmount(row.SourceAmount), BookedAmount: optionalAmount(row.BookedAmount), ReceiverDelta: optionalAmount(row.ReceiverDelta),
		PayableDelta: optionalAmount(row.PayableDelta), HeldDelta: optionalAmount(row.HeldDelta), ReceiverUSDDelta: usd, TxHash: httpio.OrNull(row.TxHash), LogIndex: row.LogIndex,
		TransferLogIndex: row.TransferLogIndex, BlockHash: httpio.OrNull(row.BlockHash), BlockNumber: row.BlockNumber, BlockTime: optionalTime(row.BlockTime),
		From: httpio.OrNull(row.From), To: httpio.OrNull(row.To), Status: row.Status, Verified: row.Verified, VerifiedBlock: row.VerifiedBlock, VerifiedHash: httpio.OrNull(row.VerifiedHash),
		PolicyException: httpio.OrNull(row.PolicyException), ReconciliationError: httpio.OrNull(row.ReconciliationError),
		PaidWith: toPaidWith(row.PaidWith)}
}

func toPaidWith(p *invoice.MovementPaidWith) *paidWithJSON {
	if p == nil || p.Amount == nil {
		return nil
	}
	return &paidWithJSON{Provider: "near_intents", Symbol: p.Symbol, Blockchain: p.Blockchain, Decimals: p.Decimals,
		Amount: p.Amount.String(), TxHash: httpio.OrNull(p.TxHash)}
}

func readMovementQuery(r *http.Request) (invoice.MovementQuery, error) {
	query, err := readQuery(r)
	if err != nil {
		return invoice.MovementQuery{}, err
	}
	after := query.Cursor
	query.Cursor = ""
	from, to, err := httpio.DayRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		return invoice.MovementQuery{}, err
	}
	return invoice.MovementQuery{PaymentQuery: query, PaymentID: r.PathValue("paymentId"), After: after, From: from, To: to}, nil
}

func movements(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query, err := readMovementQuery(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		page, err := invoices.PaymentMovements(r.Context(), r.PathValue("profileId"), query)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			SnapshotAt string         `json:"snapshotAt"`
			Items      []movementJSON `json:"items"`
			NextCursor *string        `json:"nextCursor"`
		}{SnapshotAt: page.SnapshotAt.UTC().Format(time.RFC3339Nano), Items: []movementJSON{}, NextCursor: httpio.OrNull(page.NextCursor)}
		for _, item := range page.Items {
			out.Items = append(out.Items, toMovement(item))
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
