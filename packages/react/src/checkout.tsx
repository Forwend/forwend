"use client";

import {
  CHECKOUT_LAYOUTS,
  type CheckoutLayout,
  type CheckoutOptions,
  mountCheckout,
} from "@forwend/js";
import { type CSSProperties, useEffect, useRef } from "react";

export interface CheckoutProps extends Omit<CheckoutOptions, "layout"> {
  className?: string;
  style?: CSSProperties;
}

/** The whole checkout, framed in your page. Its events are hints: fulfil the order from the webhook. */
export function Checkout(props: CheckoutProps) {
  return <Frame {...props} layout={CHECKOUT_LAYOUTS.full} />;
}

/** The checkout's pay panel, for your own checkout page that already shows the order. */
export function PaymentElement(props: CheckoutProps) {
  return <Frame {...props} layout={CHECKOUT_LAYOUTS.element} />;
}

function Frame({
  className,
  style,
  payToken,
  layout,
  theme,
  baseUrl,
  title,
  initialHeight,
  readyTimeout,
  ...handlers
}: CheckoutProps & { layout: CheckoutLayout }) {
  const box = useRef<HTMLDivElement>(null);
  // The latest handlers, so a new function on each render doesn't load the checkout again.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!box.current) return;
    const checkout = mountCheckout(box.current, {
      payToken,
      layout,
      theme,
      baseUrl,
      title,
      initialHeight,
      readyTimeout,
      onReady: (event) => latest.current.onReady?.(event),
      onStatus: (event) => latest.current.onStatus?.(event),
      onLoadError: () => latest.current.onLoadError?.(),
    });
    return () => checkout.destroy();
  }, [payToken, layout, theme, baseUrl, title, initialHeight, readyTimeout]);
  return <div ref={box} className={className} style={style} />;
}
