export const ACTIVITY_COPY = {
  columns: { event: "Event", network: "Network", when: "When", status: "Status", amount: "Amount" },
  activity: "Activity",
  intro: "Payments and invoices as they happen. An invoice shows what was asked.",
  emptyTitle: "No activity yet",
  emptyText: "Payments and invoices show here as they happen.",
  activityFailed: "We could not load the activity.",
  loadMore: "Show more",
  updateFailed: "We could not update the activity.",
  invoice: "Invoice created",
  deposit: "Payment",
  held: "Held for the payer",
  partHeld: "Payment, extra held for the payer",
  retry: "Try again",
  search: "Search activity",
  searchPlaceholder: "Amount, token or hash",
  // The bell's words (R-81), with the payment each names.
  toasts: {
    paid: (amount: string, payment: string) => ({
      title: "Payment received",
      description: `${payment} is paid: ${amount}.`,
    }),
    settled: (amount: string, payment: string) => ({
      title: "In your wallet",
      description: `${amount} for ${payment} is in your wallet.`,
    }),
  },
} as const;
