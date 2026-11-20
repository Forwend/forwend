import { EmbedFrame } from "@/features/pay/components/embed-frame";
import { PayInvoice } from "@/features/pay/components/pay-invoice";
import type { EmbedLayout } from "@/features/pay/types/pay";
import { CheckoutPage } from "@/screens/pay/checkout-page";

export interface PayScreenProps {
  linkToken: string;
  option?: string;
  preview?: boolean; // the owner's visit, not counted as a payer's view
  embed?: { layout: EmbedLayout; origin: string }; // origin: the page that frames it
}

export function PayScreen({ linkToken, option, preview, embed }: PayScreenProps) {
  const page = (
    <CheckoutPage embeddedToken={embed ? linkToken : undefined}>
      <PayInvoice linkToken={linkToken} option={option} preview={preview} embed={embed?.layout} />
    </CheckoutPage>
  );
  return embed ? (
    <EmbedFrame linkToken={linkToken} origin={embed.origin}>
      {page}
    </EmbedFrame>
  ) : (
    page
  );
}
