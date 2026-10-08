import { THEMES } from "@forwend/design-tokens";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BRAND_COLORS } from "@/constants/brand-colors";
import { SITE } from "@/constants/site";
import { fontVars } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: SITE.title,
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: SITE.title, description: SITE.description },
};

export const viewport: Viewport = {
  themeColor: BRAND_COLORS.bg,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme={THEMES.light} className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
