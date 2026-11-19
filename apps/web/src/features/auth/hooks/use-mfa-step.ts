"use client";

import { type MfaMethod, useMfa } from "@privy-io/react-auth";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { MfaStep } from "@/features/auth/components/mfa-step";
import type { Claim } from "@/features/auth/lib/claim";

export interface MfaScope {
  open: (methods: MfaMethod[]) => void;
}

export const MfaContext = createContext<Claim<MfaScope> | null>(null);

/** For a form whose action may need Privy's MFA: run starts the action, and step is what to show in place of the
 * form's buttons while Privy waits for it. busy is true while Privy checks an answer: closing then would cancel
 * nothing, since Privy goes on. onVerified runs once Privy takes the answer. */
export function useMfaStep({ onVerified }: { onVerified?: () => void } = {}) {
  const controller = useContext(MfaContext);
  const { cancel } = useMfa();
  const [methods, setMethods] = useState<MfaMethod[] | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const scope = useRef<MfaScope>({
    open: (m) => {
      asked.current = true;
      setMethods(m);
    },
  });
  // An action Privy never settles, such as its export window closed early, keeps no claim once it is answered.
  const end = useCallback(() => {
    controller?.release(scope.current);
    asked.current = false;
    setMethods(null);
    setBusy(false);
  }, [controller]);
  // The form went away with Privy still asking, such as the send sheet closed during a setup: the action that asked
  // ends, and the next ask shows where it is made, not in a form no longer there.
  const cancelAsk = useRef(cancel);
  cancelAsk.current = cancel;
  useEffect(
    () => () => {
      controller?.release(scope.current);
      if (asked.current) cancelAsk.current();
    },
    [controller],
  );
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      controller?.claim(scope.current);
      try {
        return await action();
      } finally {
        end();
      }
    },
    [controller, end],
  );
  const step = methods
    ? createElement(MfaStep, {
        methods,
        onBusy: setBusy,
        onVerified: () => {
          end();
          onVerified?.();
        },
        onCancel: cancel,
      })
    : null;
  return { run, step, busy, cancel: () => (methods && !busy ? cancel() : undefined) };
}
