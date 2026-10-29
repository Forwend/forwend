/** Shared by every place that names an amount (R-70). */
export const MONEY_COPY = {
  usd: "USD",
  anyNetwork: "Any network",
  /** A checkout has no number: lists, toasts and the bell name it by its id. */
  checkout: (id: string) => `Checkout ${id.slice(2, 8)}`,
} as const;
