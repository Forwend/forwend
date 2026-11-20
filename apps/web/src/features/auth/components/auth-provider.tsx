"use client";

import { THEME_ATTRIBUTE, THEMES, type Theme } from "@forwend/design-tokens";
import { PrivyProvider } from "@privy-io/react-auth";
import { type ReactNode, useEffect, useState } from "react";
import { MfaProvider } from "@/features/auth/components/mfa-provider";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { PRIVY_CHAINS } from "@/features/auth/constants/privy-chains";

/** Each must also be on in the Privy dashboard. */
const LOGIN_METHODS = ["email", "google", "passkey"] as const;

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [theme, setTheme] = useState<Theme>(THEMES.light);
  useEffect(() => {
    if (document.documentElement.getAttribute(THEME_ATTRIBUTE) === THEMES.dark)
      setTheme(THEMES.dark);
  }, []);
  if (!APP_ID) {
    return (
      <main className="p-6">
        <h1 className="text-lg text-ink">{AUTH_COPY.notConfigured}</h1>
      </main>
    );
  }
  return (
    <PrivyProvider
      appId={APP_ID}
      // An empty wallet list stops Privy loading WalletConnect on every page.
      config={{
        loginMethods: [...LOGIN_METHODS],
        appearance: { theme, walletList: [] },
        externalWallets: { walletConnect: { enabled: false } },
        supportedChains: PRIVY_CHAINS,
        // Privy still asks for MFA; MfaProvider shows the ask in Forwend's own step.
        mfa: { noPromptOnMfaRequired: true },
        passkeys: { shouldUnlinkOnUnenrollMfa: false },
      }}
    >
      <MfaProvider>{children}</MfaProvider>
    </PrivyProvider>
  );
}
