import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAY_TOKEN_PATTERN } from "@/features/invoices/constants/invoices";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { PublicStoreProvider } from "@/providers/public-store-provider";
import { PayScreen } from "@/screens/pay/pay-screen";

// Outside the (app) group: no Privy and no sign-in. Anyone with the link may pay, so search engines stay out.
export const metadata: Metadata = {
  title: PAY_COPY.title,
  robots: { index: false, follow: false },
};

export default async function PayPage({ params, searchParams }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  if (!PAY_TOKEN_PATTERN.test(token)) notFound();
  // One option of a payer-chooses invoice (R-56); the canary opens each this way.
  const { option } = await searchParams;
  return (
    <PublicStoreProvider>
      <PayScreen linkToken={token} option={typeof option === "string" ? option : undefined} />
    </PublicStoreProvider>
  );
}
