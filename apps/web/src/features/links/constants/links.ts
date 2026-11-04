/** Where a link stands (R-140, R-142): off by the owner, past its end date, or at its payment cap; only "on" takes
 * payments. */
export const LINK_STATES = {
  on: "on",
  off: "off",
  ended: "ended",
  full: "full",
  notReady: "not_ready",
} as const;

export const LINK_CHANGED_CODE = "link_changed";
export const LINK_SETUP_REQUIRED_CODE = `link_${LINK_STATES.notReady}`;

/** Pay's answer for a link that is not on (R-142): its error code names the state. */
export const LINK_CLOSED_CODES = Object.values(LINK_STATES)
  .filter((state) => state !== LINK_STATES.on)
  .map((state) => `link_${state}`);

/** Pay's answer while the link's owner has no billing details, so no invoice can be made (R-92). */
export const LINK_NOT_READY_CODE = "billing_details_required";

/** A fixed amount, or one the payer enters within the owner's optional min and max (D-94). */
export const AMOUNT_KINDS = { fixed: "fixed", open: "open" } as const;

/** The API's limits (apps/backend/api/openapi.yaml, PaymentLinkRequest). */
export const LINK_LIMITS = { title: 200, maxPayments: 1_000_000 } as const;

export const LINKS_PAGE_SIZE = 20;

/** A link's address (D-94): 12 random lowercase letters and digits. */
export const LINK_SLUG_PATTERN = /^[a-z0-9]{12}$/;

/** A USD amount as the API takes it: whole dollars and at most two decimals. */
export const USD_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
