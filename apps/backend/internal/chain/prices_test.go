package chain

import (
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

// R-227, R-229: a price past its heartbeat and a half, or read while the L2 sequencer is down or just back, sets no
// fee and no swap floor.
func TestEthPriceRefusesAStaleOrUntrustedPrice(t *testing.T) {
	a := chaintest.Start(t)
	client := ethclient.NewClient(a.RPC)
	feed := common.HexToAddress("0x00000000000000000000000000000000000000f1")
	sequencer := common.HexToAddress("0x00000000000000000000000000000000000000f2")
	EthUSD[chaintest.ChainID] = PriceFeed{Address: feed, Heartbeat: time.Hour}
	t.Cleanup(func() { delete(EthUSD, chaintest.ChainID); delete(SequencerUptime, chaintest.ChainID) })
	ago := func(d time.Duration) int64 { return time.Now().Add(-d).Unix() }
	price := big.NewInt(2000e8)

	a.Feed(feed, price, 0, 0)
	if got, err := EthPrice(t.Context(), client, chaintest.ChainID); err != nil || got.Cmp(price) != 0 {
		t.Fatalf("a fresh price: %v (%v), want %s", got, err, price)
	}
	a.Feed(feed, price, ago(2*time.Hour), ago(80*time.Minute))
	if got, err := EthPrice(t.Context(), client, chaintest.ChainID); err != nil || got.Cmp(price) != 0 {
		t.Fatalf("a price within its heartbeat and a half: %v (%v), want %s", got, err, price)
	}
	a.Feed(feed, price, ago(2*time.Hour), ago(100*time.Minute))
	if _, err := EthPrice(t.Context(), client, chaintest.ChainID); err == nil ||
		!strings.Contains(err.Error(), "past its 1h0m0s heartbeat") {
		t.Fatalf("a price past its heartbeat and a half: %v, want refused", err)
	}

	a.Feed(feed, price, 0, 0)
	SequencerUptime[chaintest.ChainID] = sequencer
	for _, c := range []struct {
		name          string
		status, since int64
		refused       string
	}{
		{"down", 1, ago(24 * time.Hour), "sequencer is down"},
		{"back ten minutes ago", 0, ago(10 * time.Minute), "sequencer came back"},
		{"up for a day", 0, ago(24 * time.Hour), ""},
	} {
		a.Feed(sequencer, big.NewInt(c.status), c.since, 0)
		got, err := EthPrice(t.Context(), client, chaintest.ChainID)
		if c.refused == "" && (err != nil || got.Cmp(price) != 0) {
			t.Errorf("sequencer %s: %v (%v), want %s", c.name, got, err, price)
		}
		if c.refused != "" && (err == nil || !strings.Contains(err.Error(), c.refused)) {
			t.Errorf("sequencer %s: %v, want refused as %q", c.name, err, c.refused)
		}
	}
}

func TestEveryEthUSDFeedHasAHeartbeat(t *testing.T) {
	for id, feed := range EthUSD {
		if feed.Heartbeat <= 0 || feed.Address == (common.Address{}) {
			t.Errorf("chain %d's ETH/USD feed %v", id, feed)
		}
	}
}
