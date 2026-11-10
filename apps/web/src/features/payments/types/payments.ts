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
  /** The derived payment state (D-114). */
  state?: string;
  /** The derived wallet transfer state (D-114). */
  wallet?: string;
  /** pending: paid, and the money is not in the wallet yet. */
  settlementStatus?: string;
  /** An exact order reference. */
  reference?: string;
}
export interface PaymentPeriod {
  from?: string;
  to?: string;
}
export type PaymentOption = PaymentDetail["options"][number];
export type PaymentDeposit = PaymentOption["deposits"][number];
export type PaymentReturn = PaymentOption["returns"][number];
export type CrossChainPayment = NonNullable<PaymentDetail["crossChain"]>;
export type SumCellId = (typeof SUM_CELLS)[keyof typeof SUM_CELLS];
/** One figure of the payment page's sum, in its own token's base units. */
export interface SumCell {
  id: SumCellId;
  units: bigint;
  decimals: number;
  symbol: string;
}
export interface PaymentMoney {
  /** The option the figures follow, once it holds money. */
  lead: PaymentOption | undefined;
  /** The token money arrived in, else the one the payment is fixed to. */
  paidWith: PaymentOption | undefined;
  cells: SumCell[];
  /** The first figure less every one after it equals the last: only then the page draws the sum's signs. */
  adds: boolean;
  settled: boolean;
  /** Paid and on its way: the wallet transfer is neither done, refused nor waiting. */
  moving: boolean;
}
/** One row of How the money moved: a fact the API gave, or the next thing to happen. */
export type JourneyStep = { id: string; state: TimelineState } & (
  | { kind: typeof JOURNEY_KINDS.created | typeof JOURNEY_KINDS.closed }
  | {
      kind:
        | typeof JOURNEY_KINDS.origin
        | typeof JOURNEY_KINDS.surplus
        | typeof JOURNEY_KINDS.converting;
      cross: CrossChainPayment;
    }
  /** With the NEAR Intents payment whose USDC it waits for. */
  | { kind: typeof JOURNEY_KINDS.awaiting; cross: CrossChainPayment | null }
  | {
      kind: typeof JOURNEY_KINDS.deposit;
      deposit: PaymentDeposit;
      option: PaymentOption;
      /** The USDC NEAR Intents delivered on Base. */
      converted: boolean;
      /** The deposit that paid the payment. */
      paid: boolean;
    }
  | { kind: typeof JOURNEY_KINDS.fee; cell: SumCell }
  /** Without an option: the transfer has not begun. */
  | { kind: typeof JOURNEY_KINDS.wallet; option?: PaymentOption }
  | { kind: typeof JOURNEY_KINDS.returned; option: PaymentOption; sent: PaymentReturn }
);
