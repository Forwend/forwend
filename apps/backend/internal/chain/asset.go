package chain

type Asset struct {
	ChainID  uint64
	Token    string // contract address, lowercase hex
	Symbol   string
	Decimals int
}
