import { THEMES } from "@forwend/design-tokens";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE } from "@/constants/site";
import { fontVars } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE.name,
  description: SITE.description,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme={THEMES.light} className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
