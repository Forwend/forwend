import { createHmac } from "node:crypto";
import type { CheckoutSession } from "forwend";
import { describe, expect, it, vi } from "vitest";
import { openOrders } from "@/lib/orders";
import { handleWebhook } from "@/lib/webhook";

const SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const SESSION = `0x${"ab".repeat(32)}`;

// A delivery as Forwend sends it, signed per Standard Webhooks.
function delivery(type: string, sequence: number, secret = SECRET, invoiceId = SESSION) {
  const id = `msg_${type}_${sequence}`;
  const payload = JSON.stringify({
    id: `evt_${sequence}`,
    type,
    livemode: false,
    sequence,
    timestamp: new Date().toISOString(),
    data: { invoice: { invoiceId }, held: null },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const headers = new Headers({
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  });
  return { payload, headers };
}

function shop(paymentStatus: string, reference = "order-1") {
  const orders = openOrders(":memory:");
  orders.create("order-1", [], 2400);
  orders.attach("order-1", SESSION, "f".repeat(64));
  const readSession = vi.fn(
    async () =>
      ({ sessionId: SESSION, payment: { paymentStatus, reference } }) as unknown as CheckoutSession,
  );
  return { orders, readSession, deps: { secret: SECRET, orders, readSession } };
}

describe("handleWebhook", () => {
  it("ships an order once the API says it is paid, however the events repeat or reorder", async () => {
    const { orders, deps } = shop("paid");
    for (const [type, sequence] of [
      ["invoice.settled", 3],
      ["invoice.paid", 2],
      ["invoice.paid", 2],
    ] as const) {
      const { payload, headers } = delivery(type, sequence);
      expect(await handleWebhook(payload, headers, deps)).toBe(200);
    }
    const shipped = orders.get("order-1")?.fulfilledAt;
    expect(shipped).not.toBeNull();
    expect(orders.fulfil("order-1")).toBe(false);
    expect(orders.get("order-1")?.fulfilledAt).toBe(shipped);
  });

  it("doesn't ship while the API says the payment isn't paid, whatever the event's type", async () => {
    const { orders, deps } = shop("detected");
    const { payload, headers } = delivery("invoice.paid", 2);
    expect(await handleWebhook(payload, headers, deps)).toBe(200);
    expect(orders.get("order-1")?.fulfilledAt).toBeNull();
  });

  it("refuses a forged or changed event before reading anything", async () => {
    const { orders, readSession, deps } = shop("paid");
    const forged = delivery("invoice.paid", 2, `whsec_${Buffer.alloc(32, 9).toString("base64")}`);
    expect(await handleWebhook(forged.payload, forged.headers, deps)).toBe(400);
    const changed = delivery("invoice.paid", 2);
    expect(await handleWebhook(`${changed.payload} `, changed.headers, deps)).toBe(400);
    expect(readSession).not.toHaveBeenCalled();
    expect(orders.get("order-1")?.fulfilledAt).toBeNull();
  });

  it("ignores another shop's payment and a payment whose reference isn't the order", async () => {
    const other = shop("paid");
    const elsewhere = delivery("invoice.paid", 2, SECRET, `0x${"cd".repeat(32)}`);
    expect(await handleWebhook(elsewhere.payload, elsewhere.headers, other.deps)).toBe(200);
    expect(other.readSession).not.toHaveBeenCalled();

    const mismatch = shop("paid", "order-2");
    const { payload, headers } = delivery("invoice.paid", 2);
    expect(await handleWebhook(payload, headers, mismatch.deps)).toBe(200);
    expect(mismatch.orders.get("order-1")?.fulfilledAt).toBeNull();
  });

  it("fails when the API can't be read, so Forwend sends the event again", async () => {
    const { orders, deps } = shop("paid");
    deps.readSession = vi.fn(async () => {
      throw new Error("unreachable");
    });
    const { payload, headers } = delivery("invoice.paid", 2);
    await expect(handleWebhook(payload, headers, deps)).rejects.toThrow("unreachable");
    expect(orders.get("order-1")?.fulfilledAt).toBeNull();
  });
});
