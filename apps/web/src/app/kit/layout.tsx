import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isKitEnabled } from "@/screens/kit/kit-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kit",
  robots: { index: false, follow: false },
};

export default function KitLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!isKitEnabled()) notFound();
  return children;
}
