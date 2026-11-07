import { randomUUID } from "node:crypto";
import { priceCart, usd } from "@/lib/catalog";
import { forwend, storeId, trustedIpHeader } from "@/lib/forwend";
import { limiter } from "@/lib/limit";
import { orders } from "@/lib/orders";

// Each checkout's options take from the profile's checkout quota: 1000 receive addresses open at once, 500 made a day.
// Orders nobody pays must not use it up. A checkout closes after 15 minutes, the API's least, and one that closed
// unpaid leaves the day's count. At 20 a shop per fixed 10-minute window, 15 minutes can span three windows, so at
// most 60 are open at once: with up to 8 token options each, under 500 addresses either way.
const EXPIRES_IN_SECONDS = 15 * 60;
const WINDOW_MS = 10 * 60_000;
const perVisitor = limiter(5, WINDOW_MS);
const perShop = limiter(20, WINDOW_MS);

// Prices the cart here, from the catalog, then creates the Forwend checkout for exactly that amount.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { lines?: unknown } | null;
  const cart = priceCart(body?.lines);
  if (!cart) return Response.json({ error: "Pick 1 to 10 of each item." }, { status: 422 });
  // A visitor is known only by the address the shop's own proxy writes: any other header the visitor can set.
  const header = trustedIpHeader();
  const visitor = header ? request.headers.get(header)?.split(",")[0]?.trim() : undefined;
  const wait = Math.max(visitor ? perVisitor.wait(visitor) : 0, perShop.wait("shop"));
  if (wait > 0) {
    return Response.json(
      { error: "Too many orders right now. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }
  if (visitor) perVisitor.hit(visitor);
  perShop.hit("shop");
  const id = randomUUID();
  orders().create(id, cart.lines, cart.totalCents);
  const session = await forwend().checkoutSessions.create(
    {
      storeId: storeId(),
      amountUsd: usd(cart.totalCents),
      reference: id,
      expiresIn: EXPIRES_IN_SECONDS,
      items: cart.lines.map((l) => ({
        description: l.name,
        quantity: String(l.quantity),
        unitPrice: usd(l.cents),
      })),
    },
    { idempotencyKey: id },
  );
  orders().attach(id, session.sessionId, session.payment.payToken ?? "");
  return Response.json({ orderId: id }, { status: 201 });
}
