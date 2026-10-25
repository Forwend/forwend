import { Logo } from "@forwend/ui-web";
import Link from "next/link";
import { PayInvoice } from "@/features/pay/components/pay-invoice";
import { CheckoutFooter } from "@/screens/pay/checkout-footer";
import { APP_ROUTES } from "@/shared/config/routes";

const LINK = "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus";

export interface PayScreenProps {
  /** The pay link's token (D-86). */
  linkToken: string;
  option?: string;
}

/** The public checkout (R-68). */
export function PayScreen({ linkToken, option }: PayScreenProps) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 fw-safe-x pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:gap-12 lg:py-10">
      <Link href={APP_ROUTES.site} className={`${LINK} self-start`}>
        <Logo />
      </Link>
      <main className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start items-start gap-8 has-[>[data-load-error]]:content-center lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:grid-rows-[auto_1fr] lg:has-[>[data-load-error]]:grid-rows-none lg:gap-x-16 lg:gap-y-8">
        <PayInvoice linkToken={linkToken} option={option} />
      </main>
      <CheckoutFooter />
    </div>
  );
}
