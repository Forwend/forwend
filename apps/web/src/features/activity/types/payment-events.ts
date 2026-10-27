import type { PAYMENT_EVENTS } from "@/features/activity/constants/payment-events";
import type { InvoiceEvent } from "@/features/invoices/types/invoices";

export type PaymentEventKind = (typeof PAYMENT_EVENTS)[keyof typeof PAYMENT_EVENTS];

export interface PaymentEvent {
  kind: PaymentEventKind;
  item: InvoiceEvent;
}
