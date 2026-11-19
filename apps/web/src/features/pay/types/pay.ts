import type { InvoiceToken } from "@/features/invoices/types/invoices";
import type { EMBED_LAYOUTS } from "@/features/pay/constants/embed";
import type { PAY_STATES, PAY_WAYS } from "@/features/pay/constants/pay";

export type PayToken = Pick<InvoiceToken, "symbol" | "decimals">;

export type PayState = (typeof PAY_STATES)[keyof typeof PAY_STATES];

export interface PayStatus {
  state: PayState;
  delayed: boolean;
  closed: boolean;
  canSend: boolean;
  received: bigint;
  remaining: bigint;
  late: bigint; // after the close, held for the payer
}

export type EmbedLayout = (typeof EMBED_LAYOUTS)[keyof typeof EMBED_LAYOUTS];

export type PayWay = (typeof PAY_WAYS)[keyof typeof PAY_WAYS];
