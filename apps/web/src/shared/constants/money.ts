export const USD_DECIMALS = 2;

/** A USD amount as the API takes it: up to 12 whole digits and 2 decimals. */
export const USD_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const LEAST_USD_CENTS = 100n;

export const AMOUNT_ERRORS = {
  format: "format",
  decimals: "decimals",
  zero: "zero",
  min: "min",
} as const;
