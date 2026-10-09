import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/features/auth/auth-provider";

// Sign-in and the app are private pages: Privy loads only here, never on the landing page.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SignedInLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AuthProvider>{children}</AuthProvider>;
}
