/** Shared by every place that names an amount. */
export const MONEY_COPY = {
  usd: "USD",
  anyNetwork: "Any network",
  checkout: (id: string) => `Checkout ${id.slice(2, 8)}`,
} as const;
