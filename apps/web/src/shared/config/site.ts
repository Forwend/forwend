export const SITE = {
  name: "Forwend",
  url: "https://forwend.com",
  // Set at build time; empty leaves Need help without its Email support action.
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  title: "Forwend | Get paid in stablecoins, see every step",
  titleTemplate: "Forwend | %s",
  description:
    "Invoices, checkout and an API for USDC and USDT. Every payment shows when it is detected, confirmed and settled to your own wallet.",
} as const;
