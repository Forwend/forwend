import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

// Read at request time: always on in `next dev`, and a production build serves it only with the flag.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kit",
  robots: { index: false, follow: false },
};

export default function KitLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (process.env.NODE_ENV !== "development" && process.env.KIT_ENABLED !== "1") notFound();
  return children;
}
