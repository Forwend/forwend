import { orders } from "@/lib/orders";

export async function GET(_request: Request, { params }: RouteContext<"/api/orders/[id]">) {
  const order = orders().get((await params).id);
  if (!order) return Response.json({ error: "No such order." }, { status: 404 });
  return Response.json({ paid: order.fulfilledAt !== null, fulfilledAt: order.fulfilledAt });
}
