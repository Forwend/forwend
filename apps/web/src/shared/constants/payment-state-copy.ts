export const PAYMENT_STATE_COPY = {
  status: "Status",
  all: "All",
  // A list with no rows says what narrowed it: "Search “mara”, status Expired."
  searched: (query: string) => `search “${query}”`,
  statusIs: (label: string) => `status ${label}`,
} as const;
