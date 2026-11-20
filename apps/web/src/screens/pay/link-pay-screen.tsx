import { LinkCheckout } from "@/features/pay/components/link-checkout";
import { CheckoutPage } from "@/screens/pay/checkout-page";

export function LinkPayScreen({ slug }: { slug: string }) {
  return (
    <CheckoutPage>
      <LinkCheckout slug={slug} />
    </CheckoutPage>
  );
}
