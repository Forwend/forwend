import { STATUS_FILTERS, type StatusFilter } from "@/features/activity/activity";

export const ACTIVITY_COPY = {
  activity: "Activity",
  emptyActivity: "No invoices yet. Invoices and their payments appear here.",
  activityFailed: "We could not load the activity.",
  loadMore: "Show more",
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
  } satisfies Record<StatusFilter, string>,
  search: "Search activity",
  searchPlaceholder: "Search amount, network or hash",
  noMatch: "Nothing matches this filter.",
} as const;
