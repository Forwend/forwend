export const REFRESH_MS = 15_000;

/** Query options for server data that changes on its own. */
export const LIVE_QUERY = {
  pollingInterval: REFRESH_MS,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
} as const;

/** For a read that checks every payment of a profile, such as the Payments Issues view. */
export const SLOW_LIVE_QUERY = { ...LIVE_QUERY, pollingInterval: 60_000 } as const;
