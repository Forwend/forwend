export const PROFILE_TABS = {
  personal: "personal",
  freelancer: "freelancer",
  merchant: "merchant",
  developers: "developers",
} as const;

export const PROFILES = {
  title: "One login. A profile for each way you get paid.",
  body: "Keep personal money, client work and a store apart, each with its own wallet and history.",
  tabs: {
    personal: {
      label: "Personal",
      title: "Your everyday stablecoin account",
      body: "Receive, hold and send USDC. See what is available, what is still arriving, and anything held for a refund.",
    },
    freelancer: {
      label: "Freelancer",
      title: "Invoices your clients can actually pay",
      body: "Saved clients, due dates and a payment page that shows the exact token and network. Partial payments show what is still due.",
    },
    merchant: {
      label: "Merchant",
      title: "Checkout for every store you run",
      body: "Hosted checkout and payment links per store, with your logo and colors. Every payment keeps its store and order reference.",
    },
    developers: {
      label: "Developers",
      title: "Payments your backend can trust",
      body: "Create an invoice with one call, then react to signed events. Detected and confirmed are separate events, never mixed up.",
    },
  },
} as const;

export type ProfileTab = keyof typeof PROFILES.tabs;
