import { THEME_ATTRIBUTE, THEMES } from "@forwend/design-tokens";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAY_TOKEN_PATTERN } from "@/features/invoices/constants/invoices";
import { EMBED_LAYOUTS, EMBED_PARAMS } from "@/features/pay/constants/embed";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { PayScreen } from "@/screens/pay/pay-screen";

export const metadata: Metadata = {
  title: PAY_COPY.title,
  robots: { index: false, follow: false },
};

// R-168: the checkout in a merchant's page. src/proxy.ts lets only the store's origin the query names frame it.
export default async function EmbedPage({ params, searchParams }: PageProps<"/embed/[token]">) {
  const { token } = await params;
  if (!PAY_TOKEN_PATTERN.test(token)) notFound();
  const query = await searchParams;
  // The first value, as the proxy reads it, so messages go only to the origin it let frame the page.
  const origin = [query[EMBED_PARAMS.origin]].flat()[0] ?? "";
  const theme = Object.values(THEMES).find((t) => t === query[EMBED_PARAMS.theme]);
  return (
    <>
      {/* The merchant's page picks the theme, set before the first paint as the head script sets the visitor's. */}
      {theme ? (
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed theme name from THEMES, never the query's text
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.setAttribute("${THEME_ATTRIBUTE}","${theme}")`,
          }}
        />
      ) : null}
      <PayScreen
        linkToken={token}
        embed={{
          layout:
            query[EMBED_PARAMS.layout] === EMBED_LAYOUTS.element
              ? EMBED_LAYOUTS.element
              : EMBED_LAYOUTS.full,
          origin,
        }}
      />
    </>
  );
}
