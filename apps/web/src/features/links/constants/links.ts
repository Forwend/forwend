/** Where a link stands on the owner's list (R-140): off by the owner, past its end date, or at its payment cap. */
export const LINK_STATES = { on: "on", off: "off", ended: "ended", full: "full" } as const;

/** A fixed amount, or one the payer enters within the owner's optional min and max (D-94). */
export const AMOUNT_KINDS = { fixed: "fixed", open: "open" } as const;

/** The API's limits (apps/backend/api/openapi.yaml, PaymentLinkRequest). */
export const LINK_LIMITS = { title: 200, maxPayments: 1_000_000 } as const;

/** A USD amount as the API takes it: whole dollars and at most two decimals. */
export const USD_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
