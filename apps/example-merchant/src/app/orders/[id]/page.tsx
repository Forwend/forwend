import { notFound } from "next/navigation";
import { OrderCheckout } from "@/components/order-checkout";
import { usd } from "@/lib/catalog";
import { forwendUrl } from "@/lib/forwend";
import { orders } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const order = orders().get((await params).id);
  if (!order?.payToken) notFound();
  return (
    <>
      <h1>Your order</h1>
      <section className="card" aria-label="Order">
        {order.lines.map((line) => (
          <p key={line.id} className="row">
            <span>
              {line.quantity} × {line.name}
            </span>
            <span>${usd(line.cents * line.quantity)}</span>
          </p>
        ))}
        <p className="row">
          <strong>Total</strong> <strong>${usd(order.totalCents)}</strong>
        </p>
      </section>
      <OrderCheckout orderId={order.id} payToken={order.payToken} forwendUrl={forwendUrl()} />
    </>
  );
}
