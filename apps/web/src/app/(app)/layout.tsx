import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/features/auth/components/auth-provider";
import { StoreProvider } from "@/providers/store-provider";
import { NO_INDEX } from "@/shared/config/site";

// Sign-in and the app are private pages: Privy loads only here, never on the landing page.
export const metadata: Metadata = { robots: NO_INDEX };

export default function SignedInLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AuthProvider>
      <StoreProvider>{children}</StoreProvider>
    </AuthProvider>
  );
}
