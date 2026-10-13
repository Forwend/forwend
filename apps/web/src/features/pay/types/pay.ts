import type { InvoiceToken } from "@/features/invoices/types/invoices";
import type { PAY_STATES } from "@/features/pay/constants/pay";

export type PayToken = Pick<InvoiceToken, "symbol" | "decimals">;

export type PayState = (typeof PAY_STATES)[keyof typeof PAY_STATES];
