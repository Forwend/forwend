import type { SAMPLE_STEPS } from "@/constants/sample-invoice";

export type SampleStep = (typeof SAMPLE_STEPS)[number];

export interface SampleInvoice {
  id: string;
  client: string;
  service: string;
  baseUnits: bigint;
  decimals: number;
  token: string;
  network: string;
  txHash: string;
}
