"use client";

import { Dialog } from "@forwend/ui-web";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FreshSignInStep } from "@/features/auth/components/fresh-sign-in-step";
import { OpenWhenAsked } from "@/features/auth/components/open-when-asked";
import { FRESH_SIGN_IN_COPY as COPY } from "@/features/auth/constants/auth-copy";
import {
  type FreshSignInAnswer,
  FreshSignInContext,
  type FreshSignInScope,
} from "@/features/auth/hooks/use-fresh-sign-in";
import { createClaim } from "@/features/auth/lib/claim";
import type { AskFreshSignIn } from "@/shared/api/fresh-sign-in";

export interface FreshSignInProviderProps {
  register: (ask: AskFreshSignIn) => void;
  children: ReactNode;
}

export function FreshSignInProvider({ register, children }: FreshSignInProviderProps) {
  const [claim] = useState(() => createClaim<FreshSignInScope>());
  const [fallback, setFallback] = useState<{ answer: FreshSignInAnswer; asked: number } | null>(
    null,
  );
  useEffect(
    () =>
      register(
        () =>
          new Promise<boolean>((resolve) => {
            const scope = claim.claimed();
            if (scope) scope.open(resolve);
            else setFallback((f) => ({ answer: resolve, asked: (f?.asked ?? 0) + 1 }));
          }),
      ),
    [register, claim],
  );
  return (
    <FreshSignInContext.Provider value={claim}>
      {children}
      <FallbackDialog
        asked={fallback?.asked ?? 0}
        answer={(ok) => {
          fallback?.answer(ok);
          setFallback(null);
        }}
        open={fallback !== null}
      />
    </FreshSignInContext.Provider>
  );
}

// The step mounts only once asked, so its focus lands after the dialog opens.
function FallbackDialog({
  asked,
  open,
  answer,
}: {
  asked: number;
  open: boolean;
  answer: FreshSignInAnswer;
}) {
  const latest = useRef(answer);
  latest.current = answer;
  const box = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      triggerLabel={COPY.title}
      title={COPY.title}
      closeLabel={COPY.close}
      trigger={(show) => <OpenWhenAsked asked={asked} open={show} />}
      onClose={() => latest.current(false)}
    >
      <div ref={box}>
        {open ? (
          <FreshSignInStep
            onDone={(ok) => {
              latest.current(ok);
              box.current?.closest("dialog")?.close();
            }}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
