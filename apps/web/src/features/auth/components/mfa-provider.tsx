"use client";

import { Dialog } from "@forwend/ui-web";
import { type MfaMethod, useMfa, useRegisterMfaListener } from "@privy-io/react-auth";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MfaStep } from "@/features/auth/components/mfa-step";
import { OpenWhenAsked } from "@/features/auth/components/open-when-asked";
import { FRESH_SIGN_IN_COPY } from "@/features/auth/constants/auth-copy";
import { MfaContext, type MfaScope } from "@/features/auth/hooks/use-mfa-step";
import { createClaim } from "@/features/auth/lib/claim";

// Privy shows no MFA window of its own (noPromptOnMfaRequired): the form that asked shows it.
export function MfaProvider({ children }: { children: ReactNode }) {
  const [claim] = useState(() => createClaim<MfaScope>());
  const [fallback, setFallback] = useState({ asked: 0, methods: [] as MfaMethod[] });
  // One object for good: Privy subscribes again whenever it changes.
  const listener = useMemo(
    () => ({
      onMfaRequired: ({ mfaMethods }: { mfaMethods: MfaMethod[] }) => {
        const scope = claim.claimed();
        if (scope) scope.open(mfaMethods);
        else setFallback((f) => ({ asked: f.asked + 1, methods: mfaMethods }));
      },
    }),
    [claim],
  );
  useRegisterMfaListener(listener);
  return (
    <MfaContext.Provider value={claim}>
      {children}
      <FallbackDialog asked={fallback.asked} methods={fallback.methods} />
    </MfaContext.Provider>
  );
}

function FallbackDialog({ asked, methods }: { asked: number; methods: MfaMethod[] }) {
  const { cancel } = useMfa();
  const box = useRef<HTMLDivElement>(null);
  const settled = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (asked > 0) settled.current = false;
  }, [asked]);
  const close = () => box.current?.closest("dialog")?.close();
  return (
    <Dialog
      triggerLabel={FRESH_SIGN_IN_COPY.title}
      title={FRESH_SIGN_IN_COPY.title}
      trigger={(open) => <OpenWhenAsked asked={asked} open={open} />}
      onClose={() => {
        if (settled.current) return;
        // Privy goes on with an answer it checks: the dialog stays until it says.
        if (busy) {
          box.current?.closest("dialog")?.showModal();
          return;
        }
        settled.current = true;
        cancel();
      }}
    >
      <div ref={box}>
        {asked > 0 ? (
          <MfaStep
            key={asked}
            methods={methods}
            onBusy={setBusy}
            onVerified={() => {
              settled.current = true;
              close();
            }}
            onCancel={close}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
