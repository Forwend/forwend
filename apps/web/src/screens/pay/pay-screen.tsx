import { EmbedFrame } from "@/features/pay/components/embed-frame";
import { PayInvoice } from "@/features/pay/components/pay-invoice";
import { LEFT_PAD } from "@/features/pay/constants/pay";
import type { EmbedLayout } from "@/features/pay/types/pay";
import { CheckoutFooter } from "@/screens/pay/checkout-footer";

export interface PayScreenProps {
  /** The pay link's token (D-86). */
  linkToken: string;
  option?: string;
  /** The owner opened it from their payment: their visit is not a payer's view (R-125). */
  preview?: boolean;
  /** In a merchant's page (R-168): its layout and the origin of the page that frames it. */
  embed?: { layout: EmbedLayout; origin: string };
}

/** The public checkout (R-68): from large screens the merchant's summary on the left half and the pay panel on the
 * right, as hosted checkouts split it; on phones one column with the pay panel right under the amount. */
export function PayScreen({ linkToken, option, preview, embed }: PayScreenProps) {
  const page = (
    // An embed is as tall as its content, never the screen: the framing page sizes the frame to it.
    <div
      className={`isolate flex flex-col gap-8 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-lg:fw-safe-x lg:grid lg:grid-cols-2 lg:grid-rows-[1fr_auto] lg:gap-0 lg:p-0 ${embed ? "" : "min-h-svh"}`}
    >
      <main className="flex min-w-0 flex-1 flex-col gap-8 has-[>[data-load-error]]:justify-center lg:col-span-2 lg:grid lg:grid-cols-subgrid lg:items-start lg:gap-0 lg:has-[>[data-stale]]:grid-rows-[auto_1fr]">
        <PayInvoice linkToken={linkToken} option={option} preview={preview} embed={embed?.layout} />
      </main>
      {/* Under the summary, as hosted checkouts put "Powered by": the payee's page, run by Forwend. */}
      <CheckoutFooter
        className={`lg:col-start-1 lg:justify-start lg:pt-4 lg:pb-8 lg:text-muted ${LEFT_PAD}`}
        embeddedToken={embed ? linkToken : undefined}
      />
    </div>
  );
  return embed ? (
    <EmbedFrame linkToken={linkToken} origin={embed.origin}>
      {page}
    </EmbedFrame>
  ) : (
    page
  );
}
