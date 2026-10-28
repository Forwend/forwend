export const ACTIVITY_KINDS = {
  invoice: "invoice",
  deposit: "deposit",
} as const;

export const ACTIVITY_PAGE_SIZE = 20;

export const STATUS_FILTERS = {
  all: "all",
  open: "open",
  confirming: "confirming",
  paid: "paid",
  settled: "settled",
  expired: "expired",
  canceled: "canceled",
} as const;
