import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LINK_SLUG_PATTERN } from "@/features/links/constants/links";
import { LINK_PAY_COPY } from "@/features/pay/constants/pay-copy";
import { PublicStoreProvider } from "@/providers/public-store-provider";
import { LinkPayScreen } from "@/screens/pay/link-pay-screen";

// Outside the (app) group: no Privy and no sign-in. Anyone with the link may pay; search engines stay out.
export const metadata: Metadata = {
  title: LINK_PAY_COPY.title,
  robots: { index: false, follow: false },
};

export default async function LinkPayPage({ params }: PageProps<"/l/[slug]">) {
  const { slug } = await params;
  if (!LINK_SLUG_PATTERN.test(slug)) notFound();
  return (
    <PublicStoreProvider>
      <LinkPayScreen slug={slug} />
    </PublicStoreProvider>
  );
}
