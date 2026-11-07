"use client";

import { useLinkWithPasskey, usePrivy } from "@privy-io/react-auth";
import { useCallback } from "react";
import { useCheckFreshSignInMutation } from "@/features/auth/api/auth-api";
import { registering } from "@/features/auth/lib/passkeys";
import { SITE } from "@/shared/config/site";

type Run = <T>(send: () => Promise<T>) => Promise<T>;

/** Every way to add a passkey goes through here (R-217): the api says first whether this session is fresh, and a stale
 * one confirms it's you. A form passes its useFreshSignIn().run to confirm in place; without one, the confirm comes in
 * a dialog of its own. Privy then links the passkey in the browser, and the answer is its credential ID. */
export function useAddPasskey() {
  const { linkWithPasskey } = useLinkWithPasskey();
  const { user } = usePrivy();
  const [check] = useCheckFreshSignInMutation();
  const email = user?.email?.address ?? user?.google?.email;
  const existing = (user?.linkedAccounts ?? [])
    .flatMap((a) => (a.type === "passkey" ? [a.credentialId] : []))
    .join(" ");
  return useCallback(
    async (run: Run = (send) => send()) => {
      await run(() => check().unwrap());
      return registering(
        email ? `${SITE.name} (${email})` : SITE.name,
        existing ? existing.split(" ") : [],
        linkWithPasskey,
      );
    },
    [check, linkWithPasskey, email, existing],
  );
}
