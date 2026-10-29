export const PRICES_COPY = {
  byCoinGecko: "Prices by CoinGecko",
  updated: (time: string) => `updated ${time}`,
  stale: (time: string) => `last updated ${time}, may be out of date`,
  unavailable: "unavailable right now",
  staleTotal: (time: string) => `Prices last updated ${time}; USD values may be out of date.`,
  noTotal: "Market prices are unavailable, so no USD value is shown.",
} as const;
