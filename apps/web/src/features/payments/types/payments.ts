import type { TimelineState } from "@forwend/ui-web";
import type { z } from "zod";
import type { JOURNEY_KINDS, SUM_CELLS } from "@/features/payments/constants/payments";
import type {
  attentionPageSchema,
  paymentDetailSchema,
  paymentProblemSchema,
  paymentSchema,
  reconciliationSchema,
} from "@/features/payments/schemas/payments";
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;
export type PaymentProblem = z.infer<typeof paymentProblemSchema>;
export type AttentionPage = z.infer<typeof attentionPageSchema>;
export type PaymentReconciliation = z.infer<typeof reconciliationSchema>;
export interface PaymentFilters {
  q?: string;
  storeId?: string;
  source?: Payment["source"];
  linkId?: string;
  status?: string;
  state?: string;
  wallet?: string;
  settlementStatus?: string;
  reference?: string;
}
export interface PaymentPeriod {
  from?: string;
  to?: string;
}
export type PaymentOption = PaymentDetail["options"][number];
export type PaymentDeposit = PaymentOption["deposits"][number];
type PaymentReturn = PaymentOption["returns"][number];
export type CrossChainPayment = NonNullable<PaymentDetail["crossChain"]>;
export type SumCellId = (typeof SUM_CELLS)[keyof typeof SUM_CELLS];
export interface SumCell {
  id: SumCellId;
  units: bigint;
  decimals: number;
  symbol: string;
}
export interface PaymentMoney {
  lead: PaymentOption | undefined;
  paidWith: PaymentOption | undefined;
  cells: SumCell[];
  adds: boolean; // first − the rest = last: the sum may draw its signs
  settled: boolean;
  moving: boolean;
}
export type JourneyStep = { id: string; state: TimelineState } & (
  | { kind: typeof JOURNEY_KINDS.created | typeof JOURNEY_KINDS.closed }
  | {
      kind:
        | typeof JOURNEY_KINDS.origin
        | typeof JOURNEY_KINDS.surplus
        | typeof JOURNEY_KINDS.converting;
      cross: CrossChainPayment;
    }
  | { kind: typeof JOURNEY_KINDS.awaiting; cross: CrossChainPayment | null }
  | {
      kind: typeof JOURNEY_KINDS.deposit;
      deposit: PaymentDeposit;
      option: PaymentOption;
      converted: boolean;
      paid: boolean;
    }
  | { kind: typeof JOURNEY_KINDS.fee; cell: SumCell }
  | { kind: typeof JOURNEY_KINDS.wallet; option?: PaymentOption }
  | { kind: typeof JOURNEY_KINDS.returned; option: PaymentOption; sent: PaymentReturn }
);
