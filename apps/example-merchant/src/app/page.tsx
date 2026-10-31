import { Cart } from "@/components/cart";

export default function ShopPage() {
  return (
    <>
      <h1>Example shop</h1>
      <p className="muted">
        A sample merchant on Forwend: the cart is priced on this server, and you pay in stablecoins.
      </p>
      <Cart />
    </>
  );
}
