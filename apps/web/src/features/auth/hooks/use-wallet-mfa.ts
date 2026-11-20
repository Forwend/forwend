"use client";

import { useMfa, usePrivy } from "@privy-io/react-auth";

/** Privy's own second step before it signs or exports: a stolen session alone can't move money. */
export function useWalletMfa() {
  const { user } = usePrivy();
  const { promptMfa, clear } = useMfa();
  const methods = user?.mfaMethods ?? [];
  const required = process.env.NEXT_PUBLIC_WALLET_MFA === "1";
  return {
    enrolled: methods.length > 0,
    required,
    // Both, so one lost still confirms and replaces the other.
    needed: required && !(methods.includes("passkey") && methods.includes("totp")),
    verify: promptMfa,
    forget: clear,
  };
}
