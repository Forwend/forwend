"use client";

import { THEME_ATTRIBUTE, THEMES, type Theme } from "@forwend/design-tokens";
import { PrivyProvider } from "@privy-io/react-auth";
import { type ReactNode, useEffect, useState } from "react";
import { MfaProvider } from "@/features/auth/components/mfa-step";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { PRIVY_CHAINS } from "@/features/auth/constants/privy-chains";

/** Privy login methods (D-21); each must also be enabled in the Privy dashboard. No wallet login. */
const LOGIN_METHODS = ["email", "google", "passkey"] as const;

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

// No wallet is made on login: the backend makes one per profile (D-21).
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
      // No wallet login, so no wallet list: Privy fetches WalletConnect's wallet registry for one, and starts
      // WalletConnect, on every page it loads.
      config={{
        loginMethods: [...LOGIN_METHODS],
        appearance: { theme, walletList: [] },
        externalWallets: { walletConnect: { enabled: false } },
        supportedChains: PRIVY_CHAINS,
        // Privy still requires its MFA to sign or export; Forwend asks for it in its own step (MfaProvider).
        mfa: { noPromptOnMfaRequired: true },
        // A passkey turned off as the second step stays a way to sign in.
        passkeys: { shouldUnlinkOnUnenrollMfa: false },
      }}
    >
      <MfaProvider>{children}</MfaProvider>
    </PrivyProvider>
  );
}
