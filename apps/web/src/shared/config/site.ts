export const SITE = {
  name: "Forwend",
  url: "https://forwend.com",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL, // unset hides Email support
  title: "Forwend | Get paid in stablecoins, see every step",
  titleTemplate: "Forwend | %s",
  description:
    "Get paid in stablecoins through invoices, payment links, and checkout on Base, Arbitrum, Arc and Tempo. Follow payments to your profile wallet.",
} as const;

export const NO_INDEX = { index: false, follow: false } as const;
