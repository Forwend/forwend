import type { ReactNode } from "react";
import { CheckoutFooter } from "@/screens/pay/checkout-footer";

export interface CheckoutPageProps {
  embeddedToken?: string; // only inside a merchant's page
  children: ReactNode;
}

export function CheckoutPage({ embeddedToken, children }: CheckoutPageProps) {
  return (
    // An embed is as tall as its content, never the screen: the framing page sizes the frame to it.
    <div
      className={`isolate flex flex-col gap-8 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-lg:fw-safe-x lg:grid lg:grid-cols-2 lg:grid-rows-[1fr_auto] lg:gap-0 lg:p-0 ${embeddedToken ? "" : "min-h-svh"}`}
    >
      <main className="flex min-w-0 flex-1 flex-col gap-8 has-[>[data-load-error]]:justify-center lg:col-span-2 lg:grid lg:grid-cols-subgrid lg:items-start lg:gap-0 lg:has-[>[data-stale]]:grid-rows-[auto_1fr]">
        {children}
      </main>
      <CheckoutFooter embeddedToken={embeddedToken} />
    </div>
  );
}
