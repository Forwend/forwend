"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { FreshSignInStep } from "@/features/auth/components/fresh-sign-in-step";
import type { Claim } from "@/features/auth/lib/claim";
import { needsFreshSignIn } from "@/shared/api/fresh-sign-in";

export type FreshSignInAnswer = (ok: boolean) => void;

export interface FreshSignInScope {
  open: (answer: FreshSignInAnswer) => void;
}

export const FreshSignInContext = createContext<Claim<FreshSignInScope> | null>(null);

/** run sends a request that may need a fresh sign-in; step replaces the form's buttons. */
export function useFreshSignIn() {
  const controller = useContext(FreshSignInContext);
  const [answer, setAnswer] = useState<FreshSignInAnswer | null>(null);
  const scope = useRef<FreshSignInScope>({ open: (a) => setAnswer(() => a) });
  // A form that unmounts mid-confirm gives up.
  useEffect(() => {
    const own = scope.current;
    return () => controller?.release(own);
  }, [controller]);
  const latest = useRef(answer);
  latest.current = answer;
  useEffect(() => () => latest.current?.(false), []);
  const run = useCallback(
    async <T>(send: () => Promise<T>): Promise<T> => {
      controller?.claim(scope.current);
      try {
        return await send();
      } finally {
        controller?.release(scope.current);
      }
    },
    [controller],
  );
  // A retry refused after a real sign-in must still show its error.
  const gaveUp = useRef(false);
  const done = useCallback(
    (ok: boolean) => {
      if (!answer) return;
      gaveUp.current = !ok;
      answer(ok);
      setAnswer(null);
    },
    [answer],
  );
  return {
    run,
    step: answer ? createElement(FreshSignInStep, { onDone: done }) : null,
    pending: answer !== null,
    cancel: () => done(false),
    cancelled: (error: unknown) => gaveUp.current && needsFreshSignIn(error),
  };
}
