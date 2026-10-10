import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { INVOICE_ID_PATTERN } from "@/features/pay/pay";
import { PAY_COPY } from "@/features/pay/pay-copy";
import { PublicStoreProvider } from "@/providers/public-store-provider";
import { PayScreen } from "@/screens/pay/pay-screen";

// Outside the (app) group: no Privy and no sign-in. Anyone with the link may pay, so search engines stay out.
export const metadata: Metadata = {
  title: PAY_COPY.title,
  robots: { index: false, follow: false },
};

export default async function PayPage({ params }: PageProps<"/pay/[invoiceId]">) {
  const { invoiceId } = await params;
  if (!INVOICE_ID_PATTERN.test(invoiceId)) notFound();
  return (
    <PublicStoreProvider>
      <PayScreen invoiceId={invoiceId} />
    </PublicStoreProvider>
  );
}
