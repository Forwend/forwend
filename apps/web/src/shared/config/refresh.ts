/** How often the overview reads balances and activity again while the tab is visible, in ms. */
export const REFRESH_MS = 15_000;

/** Query options for money that changes on its own: read again every REFRESH_MS while the tab is visible, and when
 * the tab comes back. */
export const LIVE_QUERY = {
  pollingInterval: REFRESH_MS,
  skipPollingIfUnfocused: true,
  refetchOnFocus: true,
} as const;
