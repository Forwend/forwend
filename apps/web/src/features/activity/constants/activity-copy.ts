export const ACTIVITY_COPY = {
  // Events are past; the status column is where the payment stands now, so it says so.
  columns: {
    event: "Event",
    network: "Network",
    when: "When",
    status: "Status now",
    amount: "Amount",
  },
  activity: "Activity",
  intro: "What happened, newest first. Status now is where each payment stands today.",
  emptyTitle: "No activity yet",
  emptyText: "Payments and invoices show here as they happen.",
  activityFailed: "We could not load the activity.",
  loadMore: "Show more",
  updateFailed: "We could not update the activity.",
  invoice: "Invoice created",
  deposit: "Payment received",
  held: "Held for the customer",
  partHeld: "Payment received, extra held for the customer",
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
