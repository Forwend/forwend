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

/** Days a group names in words; any other day is named by its date. */
export const RELATIVE_DAYS = {
  today: "today",
  yesterday: "yesterday",
} as const;

export const TRANSACTIONS_PAGE_SIZE = 20;
export const TRANSACTIONS_MAX = 100;

/** What a transaction was (R-108); money in that Forwend can't classify takes one of TRANSACTION_LABELS. */
export const TRANSACTION_CLASSES = {
  invoice: "invoice",
  ownTransfer: "own_transfer",
  sent: "sent",
  unclassified: "unclassified",
  income: "income",
  refund: "refund",
  other: "other",
} as const;

export const TRANSACTION_LABELS = [
  TRANSACTION_CLASSES.income,
  TRANSACTION_CLASSES.ownTransfer,
  TRANSACTION_CLASSES.refund,
  TRANSACTION_CLASSES.other,
] as const;

/** The records currency select's value for none: a select takes no empty value. */
export const USD_ONLY = "usd-only";

/** Every record has its USD value already, so USD is never the other records currency (R-110). */
export const RECORDS_BASE_CURRENCY = "USD";
