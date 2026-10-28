import { STATUS_FILTERS } from "@/features/activity/constants/activity";
import type { StatusFilter } from "@/features/activity/types/activity";

export const ACTIVITY_COPY = {
  activity: "Activity",
  emptyTitle: "No activity yet",
  emptyText: "Customer payments and billing activity appear here.",
  activityFailed: "We could not load the activity.",
  loadMore: "Show more",
  updateFailed: "We could not update the activity.",
  invoice: "Invoice created",
  deposit: "Payment",
  held: "Held for the payer",
  partHeld: "Payment, extra held for the payer",
  retry: "Try again",
  filterLabel: "Status",
  filters: {
    [STATUS_FILTERS.all]: "All",
    [STATUS_FILTERS.open]: "Waiting for payment",
    [STATUS_FILTERS.confirming]: "Confirming",
    [STATUS_FILTERS.paid]: "Paid",
    [STATUS_FILTERS.settled]: "In wallet",
    [STATUS_FILTERS.expired]: "Expired",
    [STATUS_FILTERS.canceled]: "Canceled",
  } satisfies Record<StatusFilter, string>,
  search: "Search activity",
  searchPlaceholder: "Search amount, token or hash",
  toasts: {
    paid: (amount: string) => ({
      title: "Payment received",
      description: `${amount} paid by the customer.`,
    }),
    settled: (amount: string) => ({
      title: "Transfer to wallet complete",
      description: `${amount} is in your wallet.`,
    }),
  },
} as const;
