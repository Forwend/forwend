/** The API's staleness rule (docs/backend/api.md#prices), checked again while an answer waits in the cache. */
export const MAX_FETCH_AGE_MS = 60 * 60_000;
export const MAX_SOURCE_AGE_MS = 24 * 60 * 60_000;

/** Query options for useGetPricesQuery: the worker reads CoinGecko every 15 minutes, so 5 is fresh enough. */
export const PRICES_QUERY = {
  pollingInterval: 5 * 60_000,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
} as const;

/** Seconds the one cached answer outlives its last reader, so moving between pages doesn't read it again. */
export const PRICES_KEEP_S = 60 * 60;

export const COINGECKO_URL = "https://www.coingecko.com";
