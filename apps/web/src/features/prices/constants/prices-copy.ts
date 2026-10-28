export const PRICES_COPY = {
  byCoinGecko: "Prices by CoinGecko",
  updated: (time: string) => `updated ${time}`,
  stale: (time: string) => `last updated ${time}, may be out of date`,
  unavailable: "unavailable right now",
} as const;
