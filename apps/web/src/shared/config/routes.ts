/** Signed-in app routes. */
export const APP_ROUTES = {
  site: "/",
  signIn: "/sign-in",
  home: "/app",
  balances: "/app/balances",
  transactions: "/app/transactions",
  activity: "/app/activity",
  invoices: "/app/invoices",
  newInvoice: "/app/invoices/new",
  newProfile: "/app/profiles/new",
  billingDetails: "/app/billing-details",
  notifications: "/app/notifications",
} as const;
