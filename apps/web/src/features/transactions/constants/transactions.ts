export const TRANSACTION_DIRECTIONS = {
  in: "in",
  out: "out",
} as const;

export const TRANSACTION_STATUSES = {
  detected: "detected",
  confirmed: "confirmed",
  sending: "sending", // ours, not the API's: signed, not mined
} as const;

export const TRANSACTION_FILTERS = {
  all: "all",
  ...TRANSACTION_DIRECTIONS,
} as const;

export const TOO_MANY_TRANSACTIONS = "too_many_transactions";

export const TRANSACTIONS_PAGE_SIZE = 20;
export const TRANSACTIONS_MAX = 100;

export const TRANSACTION_CLASSES = {
  invoice: "invoice",
  payment: "payment",
  paymentException: "payment_exception",
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

// A select can't hold an empty value, so none needs its own.
export const USD_ONLY = "usd-only";

// Every record already has its USD value, so USD is never the second currency.
export const RECORDS_BASE_CURRENCY = "USD";
