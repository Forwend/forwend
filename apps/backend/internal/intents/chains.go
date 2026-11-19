package intents

import "strings"

// LeftOutChains are not offered to payers (D-127).
var LeftOutChains = map[string]bool{"btc": true}

// MemoChains need a memo beside the address, which a payer can forget and lose the money; they are left out (D-123).
var MemoChains = map[string]bool{"stellar": true, "xrp": true, "ton": true}

// SlowChains can take about an hour to mine a deposit, and 1Click's deadline must exceed that, so their quotes get a
// longer one (D-125).
var SlowChains = map[string]bool{"btc": true, "ltc": true, "doge": true, "bch": true, "zec": true, "dash": true,
	"cardano": true}

// chainNames are 1Click's chains as payers know them; ChainName writes any other in capitals.
var chainNames = map[string]string{"eth": "Ethereum", "base": "Base", "arb": "Arbitrum", "op": "Optimism",
	"pol": "Polygon", "bsc": "BNB Chain", "avax": "Avalanche", "gnosis": "Gnosis", "sol": "Solana", "tron": "Tron",
	"btc": "Bitcoin", "near": "NEAR", "sui": "Sui", "aptos": "Aptos", "doge": "Dogecoin", "ltc": "Litecoin",
	"bch": "Bitcoin Cash", "zec": "Zcash", "cardano": "Cardano", "starknet": "Starknet", "bera": "Berachain",
	"scroll": "Scroll", "monad": "Monad", "xlayer": "X Layer", "plasma": "Plasma", "hypercore": "Hyperliquid",
	"abs": "Abstract"}

// ChainName is 1Click's chain name as a reader knows it: "tron" is Tron.
func ChainName(blockchain string) string {
	if name, ok := chainNames[blockchain]; ok {
		return name
	}
	return strings.ToUpper(blockchain)
}

// Chains maps our live chain ids to 1Click's names for them, so a token the invoice takes directly is not offered.
var Chains = map[uint64]string{BaseChainID: "base", 42161: "arb"}
