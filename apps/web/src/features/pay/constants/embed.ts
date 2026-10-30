/** R-168: one route for both embeds. full is the whole checkout; element is its pay panel for the merchant's own
 * checkout page, without the title, items, note and PDF that page already shows. */
export const EMBED_LAYOUTS = {
  full: "full",
  element: "element",
} as const;

/** The embed's query: its layout, the origin of the page that frames it, and an optional theme. */
export const EMBED_PARAMS = {
  layout: "layout",
  origin: "origin",
  theme: "theme",
} as const;

/** What an embed posts to the page that frames it, and only to that origin. UI hints, never proof of payment (D-29). */
export const EMBED_MESSAGE = {
  source: "forwend",
  version: 1,
} as const;

export const EMBED_EVENTS = {
  ready: "ready",
  resize: "resize",
  status: "status",
} as const;
