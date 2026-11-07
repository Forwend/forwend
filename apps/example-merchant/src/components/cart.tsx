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
  const [failed, setFailed] = useState<string | null>(null);
  const lines = ITEMS.filter(([id]) => (quantities[id] ?? 0) > 0).map(([id]) => ({
    id,
    quantity: quantities[id],
  }));
  const total = ITEMS.reduce((sum, [id, item]) => sum + item.cents * (quantities[id] ?? 0), 0);

  async function checkout() {
    setBusy(true);
    setFailed(null);
    const answer = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    }).catch(() => null);
    if (!answer?.ok) {
      setBusy(false);
      // The server's own reason, such as its order limit; any other failure gets the general one.
      const reason = await answer?.json().then(
        (b) => b?.error,
        () => null,
      );
      setFailed(typeof reason === "string" ? reason : "The order could not be made. Try again.");
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
      {failed ? <p role="alert">{failed}</p> : null}
    </section>
  );
}
