import "./globals.css";
import { THEME_INIT_SCRIPT, THEMES } from "@forwend/design-tokens";
import { TooltipProvider } from "@forwend/ui-web";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BRAND_COLORS, BRAND_COLORS_DARK } from "@/shared/config/brand-colors";
import { fontVars } from "@/shared/config/fonts";
import { SITE } from "@/shared/config/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: SITE.titleTemplate },
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND_COLORS.bg },
    { media: "(prefers-color-scheme: dark)", color: BRAND_COLORS_DARK.bg },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // The head script may switch data-theme before React hydrates; that difference is expected.
    <html lang="en" data-theme={THEMES.light} className={fontVars} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed constant (THEME_INIT_SCRIPT) that must run before first paint to avoid a theme flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
