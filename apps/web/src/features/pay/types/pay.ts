import type { InvoiceToken } from "@/features/invoices/types/invoices";
import type { EMBED_LAYOUTS } from "@/features/pay/constants/embed";
import type { PAY_STATES } from "@/features/pay/constants/pay";

export type PayToken = Pick<InvoiceToken, "symbol" | "decimals">;

export type PayState = (typeof PAY_STATES)[keyof typeof PAY_STATES];

export type EmbedLayout = (typeof EMBED_LAYOUTS)[keyof typeof EMBED_LAYOUTS];
