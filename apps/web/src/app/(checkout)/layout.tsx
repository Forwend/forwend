import type { ReactNode } from "react";
import { PublicStoreProvider } from "@/providers/public-store-provider";

// A payment link's page and the checkout its Pay opens share one request cache, so the checkout opens with its
// invoice already read instead of an empty page.
export default function CheckoutLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <PublicStoreProvider>{children}</PublicStoreProvider>;
}
