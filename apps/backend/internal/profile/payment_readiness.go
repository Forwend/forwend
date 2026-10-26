package profile

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type acceptanceReader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PaymentReadiness struct {
	BillingDetails, Wallet, AcceptedToken bool
}

func (r PaymentReadiness) Ready() bool {
	return r.BillingDetails && r.Wallet && r.AcceptedToken
}

// ReadPaymentReadiness uses the same union of profile/store token exclusions as TokensOff.
func ReadPaymentReadiness(ctx context.Context, db acceptanceReader, profileID, storeID string, live bool) (PaymentReadiness, error) {
	var r PaymentReadiness
	err := db.QueryRow(ctx, `SELECT
		EXISTS (SELECT 1 FROM profile_billing_details WHERE profile_id = $1),
		EXISTS (SELECT 1 FROM profile_wallets WHERE profile_id = $1 AND chain_family = 'evm'),
		EXISTS (SELECT 1 FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
		    JOIN chain_cursors cur ON cur.chain_id = c.chain_id
		    WHERE t.enabled AND c.enabled AND c.chain_family = 'evm' AND c.livemode = $3
		    AND NOT EXISTS (SELECT 1 FROM profile_tokens_off o WHERE o.profile_id = $1
		                    AND o.chain_id = t.chain_id AND o.token_contract = t.contract)
		    AND NOT EXISTS (SELECT 1 FROM store_tokens_off o WHERE o.store_id = nullif($2, '')::uuid
		                    AND o.chain_id = t.chain_id AND o.token_contract = t.contract))`,
		profileID, storeID, live).Scan(&r.BillingDetails, &r.Wallet, &r.AcceptedToken)
	if err != nil {
		return PaymentReadiness{}, fmt.Errorf("read payment readiness: %w", err)
	}
	return r, nil
}
