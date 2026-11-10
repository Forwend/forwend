export const ACTIVITY_COPY = {
  columns: {
    event: "Event",
    for: "For",
    date: "Date",
    status: "Status",
    amount: "Amount",
  },
  activity: "Activity",
  // Events are past; the status column is where the payment stands now, so the intro says so.
  intro: "What happened, newest first. Status is where each payment stands now.",
  emptyTitle: "No activity yet",
  emptyText: "Payments and invoices show here as they happen.",
  noMatchTitle: "No events match",
  activityFailed: "We could not load the activity.",
  loadMore: "Show more",
  updateFailed: "We could not update the activity.",
  invoice: "Invoice created",
  deposit: "Payment received",
  held: "Held for the customer",
  partHeld: "Payment received, extra held for the customer",
  extraHeld: "Extra held",
  extraHeldNote: "extra held",
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
