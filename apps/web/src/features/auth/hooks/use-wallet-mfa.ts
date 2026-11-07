"use client";

import { useMfa, usePrivy } from "@privy-io/react-auth";

/** Privy itself asks for this second step before it signs a send or shows a key (D-49): a stolen session alone then
 * can't move money. With NEXT_PUBLIC_WALLET_MFA on, a send or an export waits until both a passkey and an
 * authenticator app are on, so losing one never locks the owner out. Once they are on, two-step is the check there,
 * and once Forwend recorded them, in place of its emailed code: verify asks for it in Forwend's own step (useMfaStep).
 * Privy then accepts it for 15 minutes on this device; forget ends that once the one action it was for is done. */
export function useWalletMfa() {
  const { user } = usePrivy();
  const { promptMfa, clear } = useMfa();
  const methods = user?.mfaMethods ?? [];
  const required = process.env.NEXT_PUBLIC_WALLET_MFA === "1";
  return {
    enrolled: methods.length > 0,
    required,
    // Both, so one lost still confirms, and removes or replaces the other (R-219).
    needed: required && !(methods.includes("passkey") && methods.includes("totp")),
    verify: promptMfa,
    forget: clear,
  };
}
