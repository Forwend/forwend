import { STATUS_FILTERS } from "@/features/activity/constants/activity";
import type { StatusFilter } from "@/features/activity/types/activity";

export const ACTIVITY_COPY = {
  activity: "Activity",
  emptyTitle: "No activity yet",
  emptyText: "Invoices and their payments appear here.",
  activityFailed: "We could not load the activity.",
  loadMore: "Show more",
  updateFailed: "We could not update the activity.",
  latestOnly: "Showing the latest 100.",
  invoice: "Invoice",
  deposit: "Payment",
  retry: "Try again",
  filterLabel: "Status",
  filters: {
    [STATUS_FILTERS.all]: "All",
    [STATUS_FILTERS.open]: "Open",
    [STATUS_FILTERS.paid]: "Paid",
    [STATUS_FILTERS.settled]: "Settled",
    [STATUS_FILTERS.expired]: "Expired",
    [STATUS_FILTERS.canceled]: "Canceled",
  } satisfies Record<StatusFilter, string>,
  search: "Search activity",
  searchPlaceholder: "Search amount, token or hash",
  toasts: {
    detected: (amount: string, confirmed: boolean) => ({
      title: "Payment detected",
      description: `${amount} ${confirmed ? "is confirmed" : "is confirming"}.`,
    }),
    settled: (amount: string) => ({
      title: "Payment settled",
      description: `${amount} is in your wallet.`,
    }),
  },
} as const;
