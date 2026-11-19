export const LINK_STATES = {
  on: "on",
  off: "off",
  ended: "ended",
  full: "full",
  notReady: "not_ready",
} as const;

export const LINK_CHANGED_CODE = "link_changed";
export const LINK_SETUP_REQUIRED_CODE = `link_${LINK_STATES.notReady}`;

/** Pay's answer for a link that is not on: its error code names the state. */
export const LINK_CLOSED_CODES = Object.values(LINK_STATES)
  .filter((state) => state !== LINK_STATES.on)
  .map((state) => `link_${state}`);

export const LINK_NOT_READY_CODE = "billing_details_required";

export const AMOUNT_KINDS = { fixed: "fixed", open: "open" } as const;

/** The API's limits (apps/backend/api/openapi.yaml, PaymentLinkRequest). */
export const LINK_LIMITS = { title: 200, maxPayments: 1_000_000 } as const;

export const LINKS_PAGE_SIZE = 20;

export const LINK_SLUG_PATTERN = /^[a-z0-9]{12}$/;

export const USD_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const OFFER_VERSION_PATTERN = /^[1-9][0-9]{0,18}$/;
