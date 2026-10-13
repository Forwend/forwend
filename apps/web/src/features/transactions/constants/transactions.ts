export const TRANSACTION_DIRECTIONS = {
  in: "in",
  out: "out",
} as const;

export const TRANSACTION_STATUSES = {
  detected: "detected",
  confirmed: "confirmed",
} as const;

export const TRANSACTION_FILTERS = {
  all: "all",
  ...TRANSACTION_DIRECTIONS,
} as const;

export const TRANSACTIONS_PAGE_SIZE = 20;
export const TRANSACTIONS_MAX = 100;
