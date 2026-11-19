"use client";

import { useLinkWithPasskey, usePrivy } from "@privy-io/react-auth";
import { useCallback } from "react";
import { useCheckFreshSignInMutation } from "@/features/auth/api/auth-api";
import { registering } from "@/features/auth/lib/passkeys";
import { loginEmail, passkeyIds } from "@/features/auth/lib/privy-user";
import { SITE } from "@/shared/config/site";

type Run = <T>(send: () => Promise<T>) => Promise<T>;

/** A stale session confirms it's you before Privy links the passkey; answers its ID. */
export function useAddPasskey() {
  const { linkWithPasskey } = useLinkWithPasskey();
  const { user } = usePrivy();
  const [check] = useCheckFreshSignInMutation();
  return useCallback(
    async (run: Run = (send) => send()) => {
      await run(() => check().unwrap());
      const email = loginEmail(user);
      return registering(
        email ? `${SITE.name} (${email})` : SITE.name,
        passkeyIds(user),
        linkWithPasskey,
      );
    },
    [check, linkWithPasskey, user],
  );
}
