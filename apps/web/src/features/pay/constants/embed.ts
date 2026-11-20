/** element is the pay panel alone, for a merchant page that already shows the order. */
export const EMBED_LAYOUTS = {
  full: "full",
  element: "element",
} as const;

export const EMBED_PARAMS = {
  layout: "layout",
  origin: "origin",
  theme: "theme",
} as const;

/** Posted only to the framing origin: UI hints, never proof of payment. */
export const EMBED_MESSAGE = {
  source: "forwend",
  version: 1,
} as const;

export const EMBED_EVENTS = {
  ready: "ready",
  resize: "resize",
  status: "status",
} as const;
