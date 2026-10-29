import { LinkCheckout } from "@/features/pay/components/link-checkout";
import { LEFT_PAD } from "@/features/pay/constants/pay";
import { CheckoutFooter } from "@/screens/pay/checkout-footer";

/** A payment link's page (R-142), split as the invoice checkout: the link's summary on the left, Pay on the right; then
 * Pay opens the checkout (R-68). */
export function LinkPayScreen({ slug }: { slug: string }) {
  return (
    <div className="isolate flex min-h-svh flex-col gap-8 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-lg:fw-safe-x lg:grid lg:grid-cols-2 lg:grid-rows-[1fr_auto] lg:gap-0 lg:p-0">
      <main className="flex min-w-0 flex-1 flex-col gap-8 has-[>[data-load-error]]:justify-center lg:col-span-2 lg:grid lg:grid-cols-subgrid lg:items-start lg:gap-0">
        <LinkCheckout slug={slug} />
      </main>
      <CheckoutFooter
        className={`lg:col-start-1 lg:justify-start lg:pt-4 lg:pb-8 lg:text-muted ${LEFT_PAD}`}
      />
    </div>
  );
}
