/** Query options for useGetPricesQuery: the worker reads prices every 15 minutes, so 5 is fresh enough. */
export const PRICES_QUERY = {
  pollingInterval: 5 * 60_000,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
} as const;

/** Seconds the one cached answer outlives its last reader, so moving between pages doesn't read it again. */
export const PRICES_KEEP_S = 60 * 60;
