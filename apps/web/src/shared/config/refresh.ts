export const REFRESH_MS = 15_000;

/** Query options for money that changes on its own. */
export const LIVE_QUERY = {
  pollingInterval: REFRESH_MS,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
} as const;
