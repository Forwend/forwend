export const ACTIVITY_DIRECTIONS = {
  incoming: "incoming",
  outgoing: "outgoing",
  /** A request such as an invoice: no money moved yet, so no sign. */
  request: "request",
} as const;
