import { Logo } from "@forwend/ui-web";
import Link from "next/link";
import { LinkCheckout, LinkCheckoutMode } from "@/features/pay/components/link-checkout";
import { CheckoutFooter } from "@/screens/pay/checkout-footer";
import { APP_ROUTES } from "@/shared/config/routes";

/** A payment link's page (R-142): one column, then Pay opens the checkout (R-68). */
export function LinkPayScreen({ slug }: { slug: string }) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 fw-safe-x pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:gap-12 lg:py-10">
      <header className="flex items-center gap-3">
        <Link
          href={APP_ROUTES.site}
          className="self-start rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Logo />
        </Link>
        <LinkCheckoutMode slug={slug} />
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-start has-[>[data-load-error]]:justify-center">
        <LinkCheckout slug={slug} />
      </main>
      <CheckoutFooter />
    </div>
  );
}
