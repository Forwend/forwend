package chain

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// PriceFeed is a Chainlink feed and its heartbeat: it answers at least that often, more often when the price moves.
type PriceFeed struct {
	Address   common.Address
	Heartbeat time.Duration
}

// EthUSD is each paymaster chain's Chainlink ETH/USD feed, 8 decimals, with its heartbeat in Chainlink's feed directory.
// Base's proxy is the directory's second proxy of the eth-usd-shared-svr-2 feed.
var EthUSD = map[uint64]PriceFeed{
	8453:   {common.HexToAddress("0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"), 1200 * time.Second},
	42161:  {common.HexToAddress("0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612"), 1755 * time.Second},
	84532:  {common.HexToAddress("0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1"), 1200 * time.Second},
	421614: {common.HexToAddress("0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165"), 120 * time.Second},
}

// SequencerUptime is each L2 mainnet's Chainlink sequencer uptime feed: 0 while the sequencer is up, 1 while it is
// down, since startedAt. While it is down, feeds can't update and their last price looks current.
var SequencerUptime = map[uint64]common.Address{
	8453:  common.HexToAddress("0xBCF85224fc0756B9Fa45aA7892530B47e10b6433"),
	42161: common.HexToAddress("0xFdB631F5EE196F0ed6FAa767959853A9F217697D"),
}

// SequencerGrace: once the sequencer is back, prices wait this long for the feeds to catch up.
const SequencerGrace = time.Hour

// PriceSlack is how much later than its heartbeat a feed may answer: its update is a transaction that can wait for a
// block, and a testnet oracle with a short heartbeat runs late now and then.
const PriceSlack = 10 * time.Minute

// EthUSDDecimals is the decimals of every EthUSD feed's answer.
const EthUSDDecimals = 8

var latestRoundData = common.Hex2Bytes("feaf968c")

// EthPrice reads the chain's ETH/USD feed: the dollars one ether costs, with EthUSDDecimals decimals. It refuses a
// price older than its heartbeat and PriceSlack, or read while the L2 sequencer is down or back for under SequencerGrace:
// such a price sets network fees and the floor of the executor's swap (R-227, R-229).
func EthPrice(ctx context.Context, client *ethclient.Client, chainID uint64) (*big.Int, error) {
	feed, ok := EthUSD[chainID]
	if !ok {
		return nil, fmt.Errorf("chain %d has no ETH/USD feed", chainID)
	}
	price, _, updated, err := latestRound(ctx, client, feed.Address)
	if err != nil {
		return nil, fmt.Errorf("chain %d ETH/USD feed %w", chainID, err)
	}
	if price.Sign() <= 0 {
		return nil, fmt.Errorf("chain %d ETH/USD feed answered no price", chainID)
	}
	if age := time.Since(updated); age > feed.Heartbeat+PriceSlack {
		return nil, fmt.Errorf("chain %d ETH/USD feed last answered %s ago, past its %s heartbeat", chainID,
			age.Round(time.Second), feed.Heartbeat)
	}
	sequencer, ok := SequencerUptime[chainID]
	if !ok {
		return price, nil
	}
	down, since, _, err := latestRound(ctx, client, sequencer)
	if err != nil {
		return nil, fmt.Errorf("chain %d sequencer uptime feed %w", chainID, err)
	}
	switch {
	case down.Sign() != 0:
		return nil, fmt.Errorf("chain %d's sequencer is down: its ETH/USD price can't be trusted", chainID)
	case since.Unix() == 0:
		return nil, fmt.Errorf("chain %d's sequencer uptime feed has no valid round", chainID)
	case time.Since(since) < SequencerGrace:
		return nil, fmt.Errorf("chain %d's sequencer came back %s ago: prices wait %s", chainID,
			time.Since(since).Round(time.Second), SequencerGrace)
	}
	return price, nil
}

// latestRound reads a Chainlink feed's latest answer, with when its round started and was last updated.
func latestRound(ctx context.Context, client *ethclient.Client, feed common.Address) (answer *big.Int, started,
	updated time.Time, err error) {
	raw, err := client.CallContract(ctx, ethereum.CallMsg{To: &feed, Data: latestRoundData}, nil)
	if err != nil {
		return nil, time.Time{}, time.Time{}, fmt.Errorf("read: %w", err)
	}
	if len(raw) != 5*32 {
		return nil, time.Time{}, time.Time{}, fmt.Errorf("answered %d bytes", len(raw))
	}
	answer = new(big.Int).SetBytes(raw[32:64])
	if raw[32]&0x80 != 0 {
		answer.SetInt64(-1)
	}
	unix := func(word []byte) time.Time { return time.Unix(new(big.Int).SetBytes(word).Int64(), 0) }
	return answer, unix(raw[64:96]), unix(raw[96:128]), nil
}
