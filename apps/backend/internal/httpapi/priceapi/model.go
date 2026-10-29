package priceapi

type pricesJSON struct {
	Prices []tokenPriceJSON `json:"prices"`
}

type tokenPriceJSON struct {
	ChainID         uint64  `json:"chainId"`
	Token           string  `json:"token"`
	Symbol          string  `json:"symbol"`
	CoinID          *string `json:"coinId"`
	USD             *string `json:"usd"`
	SourceUpdatedAt *string `json:"sourceUpdatedAt"`
	FetchedAt       *string `json:"fetchedAt"`
	Stale           bool    `json:"stale"`
}
