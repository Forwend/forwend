import type { ReactNode } from "react";
import { PublicStoreProvider } from "@/providers/public-store-provider";

// A link's page and the checkout its Pay opens share one cache, so the checkout opens already loaded.
export default function CheckoutLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <PublicStoreProvider>{children}</PublicStoreProvider>;
}
