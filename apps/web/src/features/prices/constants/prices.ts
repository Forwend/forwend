// The worker reads prices every 15 minutes, so 5 is fresh enough.
export const PRICES_QUERY = {
  pollingInterval: 5 * 60_000,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
} as const;

export const PRICES_KEEP_S = 60 * 60;
