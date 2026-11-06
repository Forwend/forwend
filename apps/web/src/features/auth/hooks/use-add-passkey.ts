"use client";

import { useLinkWithPasskey } from "@privy-io/react-auth";
import { useCallback } from "react";
import { useCheckFreshSignInMutation } from "@/features/auth/api/auth-api";

type Run = <T>(send: () => Promise<T>) => Promise<T>;

/** Every way to add a passkey goes through here (R-217): the api says first whether this session is fresh, and a stale
 * one confirms it's you. A form passes its useFreshSignIn().run to confirm in place; without one, the confirm comes in
 * a dialog of its own. Privy then links the passkey in the browser. */
export function useAddPasskey() {
  const { linkWithPasskey } = useLinkWithPasskey();
  const [check] = useCheckFreshSignInMutation();
  return useCallback(
    async (run: Run = (send) => send()) => {
      await run(() => check().unwrap());
      await linkWithPasskey();
    },
    [check, linkWithPasskey],
  );
}
