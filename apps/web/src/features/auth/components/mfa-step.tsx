"use client";

import { BUTTON_VARIANTS, Button, CodeInput } from "@forwend/ui-web";
import {
  errorIndicatesMaxMfaRetries,
  errorIndicatesMfaTimeout,
  errorIndicatesMfaVerificationFailed,
  type MfaMethod,
  useMfa,
} from "@privy-io/react-auth";
import { Fingerprint, ShieldAlert, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StepLead } from "@/features/auth/components/step-lead";
import { TWO_STEP_COPY as COPY } from "@/features/auth/constants/auth-copy";
import { CODE_LENGTH } from "@/features/auth/constants/sign-in";
import { useFullCode } from "@/features/auth/hooks/use-full-code";
import type { TwoStepMethod } from "@/features/auth/types/two-step";

export interface MfaStepProps {
  methods: MfaMethod[];
  onBusy: (busy: boolean) => void;
  onVerified: () => void;
  onCancel: () => void;
}

// The one ask: the passkey first, one tap, when the user has one for MFA; else, or as well, the app's code.
export function MfaStep({ methods, onBusy, onVerified, onCancel }: MfaStepProps) {
  const { init, submit } = useMfa();
  const passkey = methods.includes("passkey");
  const totp = methods.includes("totp");
  const [view, setView] = useState<TwoStepMethod | null>(
    passkey ? "passkey" : totp ? "totp" : null,
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  // Too many wrong answers or too slow: Privy takes no more for this ask, so only Cancel is left.
  const [over, setOver] = useState(false);
  const box = useRef<HTMLFieldSetElement>(null);
  useEffect(() => onBusy(checking), [checking, onBusy]);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      (
        box.current?.querySelector<HTMLElement>("input") ??
        box.current?.querySelector<HTMLElement>("[data-primary]")
      )?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  const failed = (e: unknown, wrong: string) => {
    setCode("");
    if (errorIndicatesMaxMfaRetries(e) || errorIndicatesMfaTimeout(e)) {
      setOver(true);
      setError(errorIndicatesMfaTimeout(e) ? COPY.timedOut : COPY.tooManyTries);
    } else setError(errorIndicatesMfaVerificationFailed(e) ? wrong : COPY.failed);
  };
  // Privy answers once the action that asked has finished.
  const answer = (send: () => Promise<void>, wrong: string) => {
    setChecking(true);
    setError("");
    send()
      .then(onVerified, (e: unknown) => failed(e, wrong))
      .finally(() => setChecking(false));
  };
  const confirmWithPasskey = () =>
    answer(async () => {
      const options = await init("passkey");
      if (!options) throw new Error("no passkey challenge");
      await submit("passkey", options);
    }, COPY.passkeyFailed);
  const retry = useFullCode(code, !checking && !over, (full) =>
    answer(() => submit("totp", full), COPY.wrongCode),
  );

  const switchTo = (next: TwoStepMethod) => {
    setView(next);
    setError("");
    setCode("");
  };
  return (
    // Not a form: it sits inside the form it confirms, so Enter confirms here instead of sending that form again.
    <fieldset
      ref={box}
      className="flex min-w-0 flex-col items-center gap-5 text-center"
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        if (!checking && !over && code.length === CODE_LENGTH) retry();
      }}
    >
      <StepLead
        icon={view === "passkey" ? Fingerprint : view === "totp" ? Smartphone : ShieldAlert}
        title={
          view === "passkey"
            ? COPY.passkeyTitle
            : view === "totp"
              ? COPY.codeTitle
              : COPY.unsupportedTitle
        }
        body={
          view === "passkey" ? COPY.passkeyBody : view === "totp" ? COPY.codeBody : COPY.noMethod
        }
      />
      {view === "totp" ? (
        // Stays enabled while the code is checked: disabling it would drop keyboard focus.
        <CodeInput
          // The headline says what to enter: the label stays for screen readers only.
          className="w-full items-center [&_label]:sr-only"
          label={COPY.codeLabel}
          length={CODE_LENGTH}
          value={code}
          onValueChange={(digits) => {
            setCode(digits);
            if (!over) setError("");
          }}
          error={error || undefined}
        />
      ) : error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex w-full flex-col gap-2">
        {view === "passkey" ? (
          <Button
            type="button"
            className="w-full"
            data-primary
            loading={checking}
            disabled={over}
            onClick={confirmWithPasskey}
          >
            <Fingerprint aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.usePasskey}
          </Button>
        ) : view === "totp" ? (
          <Button
            type="button"
            className="w-full"
            data-primary
            loading={checking}
            disabled={over}
            onClick={() => (code.length === CODE_LENGTH ? retry() : setError(COPY.wrongCode))}
          >
            {COPY.verify}
          </Button>
        ) : null}
        {passkey && totp ? (
          <Button
            type="button"
            size="sm"
            variant={BUTTON_VARIANTS.link}
            className="self-center text-sm"
            disabled={checking}
            onClick={() => switchTo(view === "passkey" ? "totp" : "passkey")}
          >
            {view === "passkey" ? COPY.useAppInstead : COPY.usePasskeyInstead}
          </Button>
        ) : null}
        {/* Off while Privy checks an answer, which goes on whatever it does. */}
        <Button
          type="button"
          className="w-full"
          variant={BUTTON_VARIANTS.ghost}
          disabled={checking}
          onClick={onCancel}
        >
          {COPY.cancel}
        </Button>
      </div>
    </fieldset>
  );
}
