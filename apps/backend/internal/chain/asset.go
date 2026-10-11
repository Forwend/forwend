package chain

// Asset is a token identified by chain and contract, with the symbol and decimals its amounts are shown in.
type Asset struct {
	ChainID  uint64
	Token    string // contract address, lowercase hex
	Symbol   string
	Decimals int
}
