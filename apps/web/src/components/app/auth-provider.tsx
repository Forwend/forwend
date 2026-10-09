"use client";

import type { Theme } from "@forwend/design-tokens";
import { THEME_ATTRIBUTE, THEMES } from "@forwend/design-tokens";
import { PrivyProvider } from "@privy-io/react-auth";
import { type ReactNode, useEffect, useState } from "react";
import { APP_COPY, LOGIN_METHODS } from "@/constants/app";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

// No wallet is made on login: the backend makes one per profile (D-21). Privy's dialog follows the page theme it
// opens on.
export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [theme, setTheme] = useState<Theme>(THEMES.light);
  useEffect(() => {
    if (document.documentElement.getAttribute(THEME_ATTRIBUTE) === THEMES.dark)
      setTheme(THEMES.dark);
  }, []);
  if (!APP_ID) {
    return (
      <main className="p-6">
        <h1 className="text-lg text-ink">{APP_COPY.notConfigured}</h1>
      </main>
    );
  }
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{ loginMethods: [...LOGIN_METHODS], appearance: { theme } }}
    >
      {children}
    </PrivyProvider>
  );
}
