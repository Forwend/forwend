import { PAYMENT_STATUS } from "@forwend/ui-web";

// Landing page copy. Claims stay inside what PLAN.md and docs/PROJECT.md decide; nothing here says
// the product is live, regulated or insured, and no pricing is stated.

export const LANDING_SECTIONS = {
  nav: "nav",
  hero: "hero",
  networks: "networks",
  how: "how",
  profiles: "profiles",
  checkout: "checkout",
  rules: "rules",
  developers: "developers",
  fees: "fees",
  faq: "faq",
  cta: "cta",
  footer: "footer",
} as const;

/** Stacked: heading above the content. Split: heading left, content right on wide screens. */
export const SECTION_LAYOUTS = {
  stacked: "stacked",
  split: "split",
} as const;

export const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#profiles", label: "Profiles" },
  { href: "#developers", label: "Developers" },
  { href: "#faq", label: "FAQ" },
] as const;

export const NAV_MENU = "Sections";

export const NETWORKS = {
  label: "Planned networks and stablecoins",
  networks: [
    { name: "Base", logo: "base" },
    { name: "Arbitrum", logo: "arbitrum" },
    { name: "Arc", logo: "arc" },
    { name: "Tempo", logo: "tempo" },
  ],
  tokens: [
    { name: "USDC", logo: "usdc" },
    { name: "USDT", logo: "usdt" },
  ],
} as const;

export const HOW = {
  title: "From invoice to your wallet, on one visible path.",
  steps: [
    {
      title: "Create an invoice",
      body: "Set the amount, the stablecoin and the network. Share a link or a PDF.",
    },
    {
      title: "Your client pays",
      body: "From a wallet or straight from an exchange withdrawal. No account needed to pay.",
    },
    {
      title: "We confirm it on chain",
      body: "You see detected, then confirmed. Nothing counts as paid until the network finalizes it.",
    },
    {
      title: "It settles to your wallet",
      body: "The invoice amount moves to your profile wallet. Keep it, send it, or withdraw to a bank.",
    },
  ],
} as const;

export const RULES = {
  title: "When a payment does not match, the rules are written down.",
  body: "Blockchain transfers cannot be stopped once sent, so every case has a rule instead of a surprise.",
  items: [
    {
      status: PAYMENT_STATUS.partiallyPaid,
      body: "The invoice waits for the rest until it expires. You and your client see exactly what is still due.",
    },
    {
      status: PAYMENT_STATUS.overpaid,
      body: "You receive the invoice amount. The extra is held separately so the payer can claim it back.",
    },
    {
      status: PAYMENT_STATUS.expiredPartiallyPaid,
      body: "An expired invoice cannot be reopened. What arrived is held until a verified refund.",
    },
  ],
  wrongNetwork: {
    title: "Sent on the wrong network",
    body: "Open a support request from the invoice page. Recovery is reviewed case by case and is never promised.",
  },
  footnote:
    "Refunds come only from held money, one per approved claim. Money already settled to you is never pulled back.",
} as const;

export const DEVELOPERS = {
  title: "An API that tells you what actually happened.",
  body: "Built around the problems developers report most with crypto payments.",
  points: [
    "Idempotent invoice creation: retries never create a second invoice",
    "Separate detected, confirmed and settled events",
    "Signed webhooks with retries and manual replay",
    "Fetch the current state of any invoice at any time",
  ],
  note: "Preview. The API is in design and names may change.",
  code: `// Create an invoice (preview)
const invoice = await forwend.invoices.create(
  { amount: "1250.00", token: "USDC", network: "base" },
  { idempotencyKey: "order-1042" },
);

// Handle a signed webhook
const event = forwend.webhooks.verify(rawBody, headers, secret);
if (event.type === "invoice.settled") {
  await markOrderPaid(event.data.reference);
}`,
} as const;

export const FEES = {
  title: "See the net amount before you confirm.",
  body: "Withdrawals to a bank are always your choice. Before you approve, the quote shows the rate, each fee and what reaches your account.",
  quote: {
    title: "Withdrawal quote",
    lines: [
      { label: "Exchange rate", detail: "Stablecoin to your bank's currency" },
      { label: "Network fee", detail: "Moving the stablecoin on chain" },
      { label: "Provider fee", detail: "Charged by the payout partner" },
      { label: "Arrives in your bank", detail: "The exact amount, before you approve" },
    ],
  },
  note: "Pricing is not set yet. Bank withdrawals depend on your country and our payout partner.",
} as const;

export const FAQ = {
  title: "Questions",
  items: [
    {
      question: "Who holds my money?",
      answer:
        "Each invoice has its own payment contract. When it is paid, the invoice amount settles to a wallet that belongs to your profile. Your personal wallet is created when you sign up, and each new profile gets its own.",
    },
    {
      question: "Which networks and stablecoins?",
      answer:
        "We plan to support USDC and USDT on Base, Arbitrum, Arc and Tempo. We start with USDC on Base and add each network only after testing it.",
    },
    {
      question: "What if someone sends on the wrong network?",
      answer:
        "The checkout warns before anyone sends. If it still happens, open a support request from the invoice page. Recovery is reviewed case by case and cannot be guaranteed.",
    },
    {
      question: "Do I need to verify my identity?",
      answer:
        "Bank withdrawals will need identity checks. Other rules depend on your country and are not final yet.",
    },
    {
      question: "When can I use it?",
      answer:
        "Forwend is in private development. Join the waitlist and we will email you when the beta opens.",
    },
  ],
} as const;

export const FINAL_CTA = {
  title: "Be first to get paid with Forwend.",
  body: "Join the waitlist for early access to invoices, checkout and the API.",
} as const;

export const FOOTER = {
  tagline: "Stablecoin payments you can follow from invoice to wallet.",
  socialsSoon: "Soon",
  socials: [
    { name: "X", icon: "x" },
    { name: "GitHub", icon: "github" },
    { name: "Discord", icon: "discord" },
    { name: "Telegram", icon: "telegram" },
    { name: "LinkedIn", icon: "linkedin" },
  ],
  legal: ["Terms (coming soon)", "Privacy (coming soon)"],
} as const;
