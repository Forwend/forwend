"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATALOG, type ItemId, MAX_QUANTITY, usd } from "@/lib/catalog";

const ITEMS = Object.entries(CATALOG) as [ItemId, (typeof CATALOG)[ItemId]][];

/** The cart. Its total is for show: the server prices the order again from the catalog. */
export function Cart() {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Partial<Record<ItemId, number>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lines = ITEMS.filter(([id]) => (quantities[id] ?? 0) > 0).map(([id]) => ({
    id,
    quantity: quantities[id],
  }));
  const total = ITEMS.reduce((sum, [id, item]) => sum + item.cents * (quantities[id] ?? 0), 0);

  async function checkout() {
    setBusy(true);
    setFailed(false);
    const answer = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    }).catch(() => null);
    if (!answer?.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    router.push(`/orders/${(await answer.json()).orderId}`);
  }

  return (
    <section className="card" aria-label="Cart">
      {ITEMS.map(([id, item]) => (
        <label key={id} className="row">
          <span>
            {item.name} <span className="muted">${usd(item.cents)}</span>
          </span>
          <input
            type="number"
            min={0}
            max={MAX_QUANTITY}
            value={quantities[id] ?? 0}
            onChange={(e) => setQuantities({ ...quantities, [id]: Number(e.target.value) })}
          />
        </label>
      ))}
      <p className="row">
        <strong>Total</strong> <strong>${usd(total)}</strong>
      </p>
      <button
        type="button"
        className="button"
        disabled={busy || lines.length === 0}
        onClick={checkout}
      >
        {busy ? "Creating the order…" : "Check out"}
      </button>
      {failed ? <p role="alert">The order could not be made. Try again.</p> : null}
    </section>
  );
}
