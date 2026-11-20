import { type CheckoutSession, verifyWebhook } from "forwend";
import type { Orders } from "@/lib/orders";

export interface WebhookDeps {
  secret: string;
  orders: Pick<Orders, "bySession" | "fulfil">;
  readSession(sessionId: string): Promise<CheckoutSession>;
}

/** Ships an order only when the API says it is paid; a failed read throws so Forwend sends again. */
export async function handleWebhook(
  payload: string,
  headers: Headers,
  deps: WebhookDeps,
): Promise<number> {
  let event: ReturnType<typeof verifyWebhook>;
  try {
    event = verifyWebhook({ payload, headers, secrets: [deps.secret] });
  } catch {
    return 400;
  }
  if (event.type === "webhook.test") return 200;
  const order = deps.orders.bySession(event.data.invoice.invoiceId);
  if (!order?.sessionId) return 200; // not one of this shop's orders
  const { payment } = await deps.readSession(order.sessionId);
  if (
    payment.paymentStatus === "paid" &&
    payment.reference === order.id &&
    deps.orders.fulfil(order.id)
  ) {
    console.log(`order ${order.id} paid: ship it`);
  }
  return 200;
}
