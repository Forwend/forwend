import type { SampleInvoice } from "@/types/payments/sample-invoice";

// Demonstration data only. Shown with a "Sample" label wherever it appears.
export const SAMPLE_INVOICE: SampleInvoice = {
  id: "FW-0042",
  client: "Brightline Studio",
  service: "Brand site, phase 2",
  baseUnits: 1250000000n,
  decimals: 6,
  token: "USDC",
  network: "Base",
  txHash: "0x8f3a91c2d4e5b6a7980f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5c21d",
};

export const SAMPLE_STEPS = ["Detected", "Confirming", "Paid", "Settled"] as const;
