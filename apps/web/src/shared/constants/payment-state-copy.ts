export const PAYMENT_STATE_COPY = {
  status: "Status",
  all: "All",
  searched: (query: string) => `search “${query}”`,
  statusIs: (label: string) => `status ${label}`,
} as const;
