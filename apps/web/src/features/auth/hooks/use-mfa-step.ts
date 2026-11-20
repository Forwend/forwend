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

/** run starts an action that may need Privy's MFA; step replaces the form's buttons. */
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
  // Privy may never settle an action (an export window closed early), so end on the answer.
  const end = useCallback(() => {
    controller?.release(scope.current);
    asked.current = false;
    setMethods(null);
    setBusy(false);
  }, [controller]);
  // Unmounting mid-ask cancels Privy's action, so the next ask shows where it is made.
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
