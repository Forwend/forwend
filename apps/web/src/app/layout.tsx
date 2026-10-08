import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE } from "@/constants/site";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE.name,
  description: SITE.description,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
