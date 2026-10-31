import { randomUUID } from "node:crypto";
import { priceCart, usd } from "@/lib/catalog";
import { forwend, storeId } from "@/lib/forwend";
import { orders } from "@/lib/orders";

// Prices the cart here, from the catalog, then creates the Forwend checkout for exactly that amount.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { lines?: unknown } | null;
  const cart = priceCart(body?.lines);
  if (!cart) return Response.json({ error: "Pick 1 to 10 of each item." }, { status: 422 });
  const id = randomUUID();
  orders().create(id, cart.lines, cart.totalCents);
  const session = await forwend().checkoutSessions.create(
    {
      storeId: storeId(),
      amountUsd: usd(cart.totalCents),
      reference: id,
      items: cart.lines.map((l) => ({
        description: l.name,
        quantity: String(l.quantity),
        unitPrice: usd(l.cents),
      })),
    },
    { idempotencyKey: id },
  );
  const payToken = new URL(session.payment.hostedUrl ?? "").pathname.split("/").at(-1) ?? "";
  orders().attach(id, session.sessionId, payToken);
  return Response.json({ orderId: id }, { status: 201 });
}
