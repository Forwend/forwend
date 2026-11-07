package settlement

import (
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// An invoice keeps the factory it was made with: one paid on a replaced factory still settles, and an invoice naming
// a factory Forwend never deployed is refused.
func TestSettleChecksTheInvoicesOwnFactory(t *testing.T) {
	v1 := common.HexToAddress("0xECe745390524e4d0B05D26F56AF7F1D38FDb7546")
	wallet := "0x1111111111111111111111111111111111111111"
	terms := address.Terms{InvoiceID: [32]byte{1}, Recipient: common.HexToAddress(wallet),
		Token: common.HexToAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e"), Amount: big.NewInt(1_000_000),
		ExpiresAt: 1_800_000_000, SettleDeadline: 1_800_086_400, IntendedChainID: 84532}
	intentOn := func(factory common.Address) intent {
		t.Helper()
		receive, err := address.ReceiveAt(factory, terms)
		if err != nil {
			t.Fatal(err)
		}
		return intent{invoiceID: common.Hash(terms.InvoiceID).Hex(), payment: ledger.Paid, chainID: 84532,
			token: strings.ToLower(common.Address(terms.Token).Hex()), recipient: wallet, wallet: &wallet,
			factory: strings.ToLower(factory.Hex()), receive: strings.ToLower(common.Address(receive).Hex()),
			amount: terms.Amount, expires: terms.ExpiresAt, deadline: terms.SettleDeadline}
	}
	for _, factory := range []common.Address{common.Address(address.Factory), v1} {
		if _, reason := check(intentOn(factory)); reason != "" {
			t.Errorf("an invoice on factory %s: %s", factory.Hex(), reason)
		}
	}
	unknown := intentOn(v1)
	unknown.factory = "0x2222222222222222222222222222222222222222"
	if _, reason := check(unknown); reason == "" {
		t.Error("an invoice on a factory Forwend never deployed passed")
	}
}
