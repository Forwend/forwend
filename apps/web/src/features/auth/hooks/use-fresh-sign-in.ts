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

/** For a form whose request may need a fresh sign-in: run sends it, and step is what to show in place of the form's
 * buttons while the user confirms. pending is true then; the form's fields should stay as they were. */
export function useFreshSignIn() {
  const controller = useContext(FreshSignInContext);
  const [answer, setAnswer] = useState<FreshSignInAnswer | null>(null);
  const scope = useRef<FreshSignInScope>({ open: (a) => setAnswer(() => a) });
  // A form that unmounts mid-confirm gives up; one whose dialog only closes calls cancel in its onClose.
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
  // Whether the last ask was given up: then a form shows no error, but a retry refused after a sign-in still fails.
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
    // For a dialog's own close: it gives up as the step's Cancel does.
    cancel: () => done(false),
    cancelled: (error: unknown) => gaveUp.current && needsFreshSignIn(error),
  };
}
