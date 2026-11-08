package paymentapi

import (
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/paymentio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type detailsJSON struct {
	DeliveryCount       int64 `json:"deliveryCount"`
	DeliveriesTruncated bool  `json:"deliveriesTruncated"`
	paymentio.Payment
	SnapshotAt string            `json:"snapshotAt"`
	Customer   customerJSON      `json:"customer"`
	Metadata   map[string]string `json:"metadata"`
	Items      []itemJSON        `json:"items"`
	Options    []optionJSON      `json:"options"`
	Deliveries []deliveryJSON    `json:"deliveries"`
	Problems   []problemJSON     `json:"problems"`
}

type customerJSON struct {
	Name  *string `json:"name"`
	Email *string `json:"email"`
}

type itemJSON struct {
	Description string `json:"description"`
	Quantity    string `json:"quantity"`
	UnitPrice   string `json:"unitPrice"`
	Amount      string `json:"amount"`
}

type optionJSON struct {
	OptionID string `json:"optionId"`
	ChainID  uint64 `json:"chainId"`
	Token    string `json:"token"`
	Symbol   string `json:"symbol"`
	Decimals int    `json:"decimals"`
	Amount   string `json:"amount"`
	paymentio.Fees
	ReceiveAddress    string              `json:"receiveAddress"`
	ClosesAt          string              `json:"closesAt"`
	PaymentStatus     string              `json:"paymentStatus"`
	SettlementStatus  string              `json:"settlementStatus"`
	RefundStatus      string              `json:"refundStatus"`
	Amounts           *paymentio.Amounts  `json:"amounts"`
	Coverage          coverageJSON        `json:"coverage"`
	Settlement        *settlementJSON     `json:"settlement"`
	Returns           []returnJSON        `json:"returns"`
	Deposits          []paymentio.Deposit `json:"deposits"`
	DepositsTruncated bool                `json:"depositsTruncated"`
}

type coverageJSON struct {
	HistoryComplete     bool    `json:"historyComplete"`
	VerifiedBlock       *uint64 `json:"verifiedBlock"`
	VerifiedHash        *string `json:"verifiedHash"`
	VerifiedTime        *string `json:"verifiedTime"`
	ObservedBalance     *string `json:"observedBalance"`
	BalanceDifference   *string `json:"balanceDifference"`
	ReconciliationError *string `json:"reconciliationError"`
	BookingError        *string `json:"bookingError"`
	RetryAt             *string `json:"retryAt"`
	UpdatedAt           string  `json:"updatedAt"`
	ChainFinalizedBlock *uint64 `json:"chainFinalizedBlock"`
	PendingDeposits     int64   `json:"pendingDeposits"`
	UnbookedDeposits    int64   `json:"unbookedDeposits"`
	UnprovedDeposits    int64   `json:"unprovedDeposits"`
	UnbookedOutflows    int64   `json:"unbookedOutflows"`
}

type returnJSON struct {
	TxHash    string `json:"txHash"`
	To        string `json:"to"`
	Amount    string `json:"amount"`
	BlockTime string `json:"blockTime"`
}

type settlementJSON struct {
	Status        string  `json:"status"`
	Wait          *string `json:"wait"`
	Attempts      int64   `json:"attempts"`
	CreatedAt     string  `json:"createdAt"`
	NextAttemptAt string  `json:"nextAttemptAt"`
	SignedAt      *string `json:"signedAt"`
	TxHash        *string `json:"txHash"`
	ReceiptTxHash *string `json:"receiptTxHash"`
	BlockNumber   *uint64 `json:"blockNumber"`
	BlocksLeft    *uint64 `json:"blocksLeft"`
	SecondsLeft   *int64  `json:"secondsLeft"`
}

type deliveryJSON struct {
	EndpointID     string  `json:"endpointId"`
	EventID        string  `json:"eventId"`
	EventType      string  `json:"eventType"`
	Status         string  `json:"status"`
	Enabled        bool    `json:"enabled"`
	Attempts       int64   `json:"attempts"`
	LastStatusCode *int    `json:"lastStatusCode"`
	LastAttemptAt  *string `json:"lastAttemptAt"`
	NextAttemptAt  string  `json:"nextAttemptAt"`
	CanManage      bool    `json:"canManage"`
}

type problemAssetJSON struct {
	ChainID  uint64 `json:"chainId"`
	Token    string `json:"token"`
	Symbol   string `json:"symbol"`
	Decimals int    `json:"decimals"`
}

type problemJSON struct {
	Amount     *string                    `json:"amount"`
	Asset      *problemAssetJSON          `json:"asset"`
	Code       invoice.PaymentProblemCode `json:"code"`
	Action     invoice.PaymentAction      `json:"action"`
	OptionID   *string                    `json:"optionId"`
	EndpointID *string                    `json:"endpointId"`
	EventID    *string                    `json:"eventId"`
	Reason     *string                    `json:"reason"`
}

func toProblems(problems []invoice.PaymentProblem, access auth.Access) []problemJSON {
	out := make([]problemJSON, 0, len(problems))
	for _, problem := range problems {
		action := problem.Action
		if action == invoice.ActionReviewWebhooks && !access.Can(auth.Webhooks) {
			action = invoice.ActionAskAdmin
		}
		row := problemJSON{Amount: optionalAmount(problem.Amount), Code: problem.Code, Action: action, OptionID: httpio.OrNull(problem.OptionID), EndpointID: httpio.OrNull(problem.EndpointID), EventID: httpio.OrNull(problem.EventID), Reason: httpio.OrNull(problem.Reason)}
		if asset := problem.Asset; asset != nil {
			row.Asset = &problemAssetJSON{ChainID: asset.ChainID, Token: asset.Token, Symbol: asset.Symbol, Decimals: asset.Decimals}
		}
		out = append(out, row)
	}
	return out
}

func toDetails(detail invoice.PaymentDetails, webURL string, access auth.Access) detailsJSON {
	out := detailsJSON{DeliveryCount: detail.DeliveryCount, DeliveriesTruncated: detail.DeliveryCount > int64(len(detail.Deliveries)), Payment: paymentio.FromInvoice(detail.Invoice, webURL), SnapshotAt: detail.SnapshotAt.UTC().Format(time.RFC3339Nano),
		Customer: customerJSON{Name: httpio.OrNull(detail.Invoice.ClientName), Email: httpio.OrNull(detail.Invoice.ClientEmail)}, Metadata: detail.Invoice.Metadata,
		Items: []itemJSON{}, Options: []optionJSON{}, Deliveries: []deliveryJSON{}, Problems: toProblems(detail.Problems, access)}
	for _, line := range detail.Invoice.Lines {
		out.Items = append(out.Items, itemJSON{Description: line.Description, Quantity: line.Quantity, UnitPrice: line.UnitPrice.String(), Amount: line.Amount.String()})
	}
	for _, option := range detail.Options {
		state := option.State
		row := optionJSON{OptionID: option.ID, ChainID: option.ChainID, Token: option.Token, Symbol: option.Symbol, Decimals: option.Decimals,
			Amount: option.Amount.String(), Fees: paymentio.FromFees(option.Amount, option.Fees), ReceiveAddress: option.ReceiveAddress, ClosesAt: option.ClosesAt.UTC().Format(time.RFC3339),
			PaymentStatus: state.PaymentStatus, SettlementStatus: state.SettlementStatus, RefundStatus: state.RefundStatus, Amounts: paymentio.FromAmounts(option.Amounts),
			Coverage: coverageJSON{HistoryComplete: state.HistoryComplete, VerifiedBlock: state.VerifiedBlock, VerifiedHash: httpio.OrNull(state.VerifiedHash),
				VerifiedTime: optionalTime(state.VerifiedTime), ObservedBalance: optionalAmount(state.ObservedBalance), BalanceDifference: optionalAmount(state.BalanceDifference),
				ReconciliationError: httpio.OrNull(state.ReconciliationError), BookingError: httpio.OrNull(state.BookingError), RetryAt: optionalTime(state.RetryAt),
				UpdatedAt: state.UpdatedAt.UTC().Format(time.RFC3339Nano), ChainFinalizedBlock: state.ChainFinalizedBlock, PendingDeposits: state.PendingDeposits,
				UnbookedDeposits: state.UnbookedDeposits, UnprovedDeposits: state.UnprovedDeposits, UnbookedOutflows: state.UnbookedOutflows},
			Deposits: paymentio.Deposits(option.Deposits), DepositsTruncated: option.DepositsTruncated, Returns: []returnJSON{}}
		for _, r := range option.Returns {
			row.Returns = append(row.Returns, returnJSON{TxHash: r.TxHash, To: r.To, Amount: r.Amount.String(),
				BlockTime: r.BlockTime.Format(time.RFC3339)})
		}
		if settlement := option.Settlement; settlement != nil {
			row.Settlement = &settlementJSON{Status: settlement.Status, Wait: httpio.OrNull(settlement.Wait), Attempts: settlement.Attempts,
				CreatedAt: settlement.CreatedAt.UTC().Format(time.RFC3339Nano), NextAttemptAt: settlement.NextAttemptAt.UTC().Format(time.RFC3339Nano),
				SignedAt: optionalTime(settlement.SignedAt), TxHash: httpio.OrNull(settlement.TxHash),
				ReceiptTxHash: settlement.ReceiptTxHash, BlockNumber: settlement.ReceiptBlock}
			if settlement.Progress != nil {
				seconds := int64(settlement.Progress.TimeLeft / time.Second)
				row.Settlement.BlocksLeft = &settlement.Progress.BlocksLeft
				row.Settlement.SecondsLeft = &seconds
			}
		}
		out.Options = append(out.Options, row)
	}
	for _, delivery := range detail.Deliveries {
		out.Deliveries = append(out.Deliveries, deliveryJSON{EndpointID: delivery.EndpointID, EventID: delivery.EventID, EventType: delivery.EventType,
			Status: delivery.Status, Enabled: delivery.Enabled, Attempts: delivery.Attempts, LastStatusCode: delivery.LastStatusCode, LastAttemptAt: optionalTime(delivery.LastAttemptAt),
			NextAttemptAt: delivery.NextAttemptAt.UTC().Format(time.RFC3339Nano), CanManage: access.Can(auth.Webhooks)})
	}
	return out
}

func optionalAmount(amount *big.Int) *string {
	if amount == nil {
		return nil
	}
	value := amount.String()
	return &value
}

func optionalTime(at *time.Time) *string {
	if at == nil {
		return nil
	}
	value := at.UTC().Format(time.RFC3339Nano)
	return &value
}
