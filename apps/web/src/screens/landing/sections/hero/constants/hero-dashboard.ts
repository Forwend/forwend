import { PAYMENT_STATUS } from "@forwend/ui-web";

// Illustrative figures for the hero's drawn overview. The layout and labels follow the signed-in merchant overview.
export const DASHBOARD = {
  profile: "North & Co.",
  balance: "18,734.20",
  change: "1,250.00",
  pending: {
    total: "1,789.00",
    parts: [
      { label: "Moving to wallet", amount: "1,250.00", share: 70, dot: "bg-ink" },
      { label: "Confirming", amount: "450.00", share: 25, dot: "bg-muted" },
      { label: "Partially paid", amount: "89.00", share: 5, dot: "bg-subtle" },
    ],
  },
  received: { total: "4,320.00", sent: "600.00" },
  assets: [
    { symbol: "USDC", amount: "16,980.00", share: 91, dot: "bg-ink" },
    { symbol: "OUSD", amount: "1,754.20", share: 9, dot: "bg-muted" },
  ],
  ranges: ["1W", "1M", "3M", "1Y"],
  unpaid: [
    { client: "Bob Ltd", detail: "INV-0011 · 12 days late", amount: "3,000.00" },
    { client: "Studio Nine", detail: "INV-0009 · Partially paid", amount: "240.00" },
  ],
  latest: [
    {
      title: "INV-0012",
      detail: "Alex Morgan · Base Sepolia",
      amount: "1,250.00",
      status: PAYMENT_STATUS.paid,
    },
    {
      title: "Logo design",
      detail: "Payment link · Arc Testnet",
      amount: "450.00",
      status: PAYMENT_STATUS.confirming,
    },
  ],
} as const;
