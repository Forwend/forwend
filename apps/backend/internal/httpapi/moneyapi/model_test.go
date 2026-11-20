package moneyapi

import (
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/openapi"
)

func TestJSONMatchesTheSpec(t *testing.T) {
	for _, c := range []struct {
		spec, hand any
		answer     bool
		loose      []string
	}{
		{spec: openapi.Activity{}, hand: activityJSON{}, answer: true},
		{spec: openapi.Balances{}, hand: balancesJSON{}, answer: true},
		{spec: openapi.BalanceHistory{}, hand: balanceHistoryJSON{}, answer: true},
		{spec: openapi.Transactions{}, hand: transactionsJSON{}, answer: true},
		{spec: openapi.RecordsCurrency{}, hand: recordsCurrencyJSON{}, answer: true},
		{spec: openapi.RecordsCurrency{}, hand: recordsCurrencyJSON{}, answer: false},
		{spec: openapi.LabelTransactionJSONBody{}, hand: labelBody{}, answer: false},
	} {
		for _, d := range openapi.Diff(c.spec, c.hand, c.answer, c.loose...) {
			t.Errorf("%T: %s", c.hand, d)
		}
	}
}
