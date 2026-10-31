"use client";

import { Checkout, PayButton, PaymentElement } from "@forwend/react";
import { useCallback, useEffect, useState } from "react";

// The three ways to pay (D-88): the pay panel in this page, the whole checkout in this page, or Forwend's own page.
const FLOWS = {
  element: "Pay on this page",
  full: "Full checkout",
  hosted: "Pay on Forwend",
} as const;
type Flow = keyof typeof FLOWS;

export interface OrderCheckoutProps {
  orderId: string;
  payToken: string;
  /** Forwend's web app. */
  forwendUrl: string;
}

export function OrderCheckout({ orderId, payToken, forwendUrl }: OrderCheckoutProps) {
  const [flow, setFlow] = useState<Flow>("element");
  const [paid, setPaid] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Paid only when this shop's server says so, after a verified webhook. The frame's events just ask it sooner.
  const check = useCallback(async () => {
    const answer = await fetch(`/api/orders/${orderId}`, { cache: "no-store" }).catch(() => null);
    if (answer?.ok) setPaid((await answer.json()).paid === true);
  }, [orderId]);
  useEffect(() => {
    if (paid) return;
    void check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [check, paid]);

  if (paid) {
    return (
      <p role="status" className="card">
        Paid. Your order is on its way.
      </p>
    );
  }
  const hosted = (
    <PayButton payToken={payToken} baseUrl={forwendUrl} className="button">
      Pay with stablecoins on Forwend
    </PayButton>
  );
  return (
    <section className="card" aria-label="Payment">
      <div className="tabs">
        {(Object.keys(FLOWS) as Flow[]).map((f) => (
          <button key={f} type="button" aria-pressed={flow === f} onClick={() => setFlow(f)}>
            {FLOWS[f]}
          </button>
        ))}
      </div>
      {flow === "element" ? (
        <PaymentElement
          payToken={payToken}
          baseUrl={forwendUrl}
          onStatus={() => void check()}
          onLoadError={() => setLoadFailed(true)}
        />
      ) : flow === "full" ? (
        <Checkout
          payToken={payToken}
          baseUrl={forwendUrl}
          onStatus={() => void check()}
          onLoadError={() => setLoadFailed(true)}
        />
      ) : (
        hosted
      )}
      {loadFailed && flow !== "hosted" ? (
        <p className="muted">The payment panel did not load. {hosted}</p>
      ) : null}
      <p role="status" className="muted">
        Waiting for payment.
      </p>
    </section>
  );
}
