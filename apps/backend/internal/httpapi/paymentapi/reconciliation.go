package paymentapi

import (
	"net/http"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

type balancesJSON struct {
	Receiver string `json:"receiver"`
	Payable  string `json:"payable"`
	Held     string `json:"held"`
}

type reconciliationAssetJSON struct {
	StoreID               *string      `json:"storeId"`
	StoreName             *string      `json:"storeName"`
	ChainID               uint64       `json:"chainId"`
	Token                 string       `json:"token"`
	Symbol                string       `json:"symbol"`
	Decimals              int          `json:"decimals"`
	Livemode              bool         `json:"livemode"`
	Opening               balancesJSON `json:"opening"`
	Changes               balancesJSON `json:"changes"`
	Closing               balancesJSON `json:"closing"`
	Settled               string       `json:"settled"`
	Refunded              string       `json:"refunded"`
	CheckpointBalance     *string      `json:"checkpointBalance"`
	CheckpointDifference  *string      `json:"checkpointDifference"`
	ReceiverCount         int64        `json:"receiverCount"`
	VerifiedReceivers     int64        `json:"verifiedReceivers"`
	UnreconciledReceivers int64        `json:"unreconciledReceivers"`
	PendingDeposits       int64        `json:"pendingDeposits"`
	UnbookedDeposits      int64        `json:"unbookedDeposits"`
	UnprovedDeposits      int64        `json:"unprovedDeposits"`
	UnbookedOutflows      int64        `json:"unbookedOutflows"`
	OtherAssetMovements   int64        `json:"otherAssetMovements"`
	PolicyExceptions      int64        `json:"policyExceptions"`
	BookedMovements       int64        `json:"bookedMovements"`
	MinVerifiedBlock      *uint64      `json:"minVerifiedBlock"`
	MaxVerifiedBlock      *uint64      `json:"maxVerifiedBlock"`
	ChainFinalizedBlock   *uint64      `json:"chainFinalizedBlock"`
}

func toBalances(value invoice.PaymentBalances) balancesJSON {
	return balancesJSON{Receiver: value.Receiver.String(), Payable: value.Payable.String(), Held: value.Held.String()}
}

func reconciliation(invoices *invoice.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query, err := readMovementQuery(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if query.After != "" {
			httpio.WriteError(w, r, httpio.ErrInvalidQuery)
			return
		}
		result, err := invoices.PaymentReconciliation(r.Context(), r.PathValue("profileId"), query)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		out := struct {
			SnapshotAt string                    `json:"snapshotAt"`
			From       string                    `json:"from"`
			To         string                    `json:"to"`
			Assets     []reconciliationAssetJSON `json:"assets"`
		}{SnapshotAt: result.SnapshotAt.UTC().Format(time.RFC3339Nano), From: result.From.UTC().Format(time.RFC3339), To: result.To.UTC().Format(time.RFC3339), Assets: []reconciliationAssetJSON{}}
		for _, asset := range result.Assets {
			out.Assets = append(out.Assets, reconciliationAssetJSON{
				StoreID: httpio.OrNull(asset.StoreID), StoreName: httpio.OrNull(asset.StoreName), ChainID: asset.ChainID, Token: asset.Token, Symbol: asset.Symbol, Decimals: asset.Decimals, Livemode: asset.Livemode,
				Opening: toBalances(asset.Opening), Changes: toBalances(asset.Changes), Closing: toBalances(asset.Closing), Settled: asset.Settled.String(), Refunded: asset.Refunded.String(),
				CheckpointBalance: optionalAmount(asset.CheckpointBalance), CheckpointDifference: optionalAmount(asset.CheckpointDifference), ReceiverCount: asset.ReceiverCount, VerifiedReceivers: asset.VerifiedReceivers, UnreconciledReceivers: asset.UnreconciledReceivers,
				PendingDeposits: asset.PendingDeposits, UnbookedDeposits: asset.UnbookedDeposits, UnprovedDeposits: asset.UnprovedDeposits, UnbookedOutflows: asset.UnbookedOutflows, OtherAssetMovements: asset.OtherAssetMovements, PolicyExceptions: asset.PolicyExceptions, BookedMovements: asset.BookedMovements,
				MinVerifiedBlock: asset.MinVerifiedBlock, MaxVerifiedBlock: asset.MaxVerifiedBlock, ChainFinalizedBlock: asset.ChainFinalizedBlock})
		}
		httpio.WriteJSON(w, http.StatusOK, out)
	}
}
