"use client";

import { BUTTON_VARIANTS, Button, CodeInput } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { Mail } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSendFreshCodeMutation, useVerifyFreshCodeMutation } from "@/features/auth/api/auth-api";
import { StepLead } from "@/features/auth/components/step-lead";
import { FRESH_SIGN_IN_COPY as COPY } from "@/features/auth/constants/auth-copy";
import { CODE_LENGTH, FRESH_CODE_ERRORS } from "@/features/auth/constants/sign-in";
import { useFullCode } from "@/features/auth/hooks/use-full-code";
import { loginEmail } from "@/features/auth/lib/privy-user";

export interface FreshSignInStepProps {
  onDone: (ok: boolean) => void;
}

// A code sent to the login email, as the two-step views look: the mail mark, where the code went, the boxes, one
// status line under them, then Confirm full width and a quiet Cancel.
export function FreshSignInStep({ onDone }: FreshSignInStepProps) {
  const { user } = usePrivy();
  // Forwend's own code (R-137): a Privy sign-in made while signed in keeps the session and its sign-in time, so the
  // api can't tell it happened (D-49).
  const [sendCode] = useSendFreshCodeMutation();
  const [verifyCode] = useVerifyFreshCodeMutation();
  const email = loginEmail(user);
  const [noEmail, setNoEmail] = useState(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  // The hour's codes are used up (too_many_codes): the step counts down to the api's Retry-After, then offers a code.
  const [tooMany, setTooMany] = useState(false);
  const [error, setError] = useState("");
  // Sending and checking don't wait on each other: a code from an earlier email still works while a new one goes.
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const now = useNow(resendAt);
  const box = useRef<HTMLFieldSetElement>(null);

  const send = useCallback(async () => {
    if (!email) return;
    setSending(true);
    setSendFailed(false);
    setTooMany(false);
    try {
      const { resendAfterSeconds } = await sendCode().unwrap();
      setSent(true);
      setResendAt(Date.now() + resendAfterSeconds * 1000);
    } catch (e) {
      const failure = e as FetchBaseQueryError & { retryAfterSeconds?: number };
      const code = (failure.data as { error?: { code?: string } } | undefined)?.error?.code;
      const waitUntil = Date.now() + (failure.retryAfterSeconds ?? 0) * 1000;
      // This session's code sent a moment ago is still the one to enter.
      if (code === FRESH_CODE_ERRORS.sentRecently) {
        setSent(true);
        setResendAt(waitUntil);
      } else if (code === FRESH_CODE_ERRORS.noLoginEmail) setNoEmail(true);
      else if (code === FRESH_CODE_ERRORS.tooMany) {
        setTooMany(true);
        setResendAt(waitUntil);
      } else setSendFailed(true);
    } finally {
      setSending(false);
    }
  }, [email, sendCode]);
  // A new code makes the old one useless: the boxes empty and take the focus for the new one.
  const resend = () => {
    setCode("");
    setError("");
    box.current?.querySelector<HTMLElement>("input")?.focus();
    void send();
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
  }, [send]);
  // Focus after the step shows, so it lands in a dialog too: showModal moves focus after React's autoFocus ran.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      (
        box.current?.querySelector<HTMLElement>("input") ??
        box.current?.querySelector<HTMLElement>("button")
      )?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  // The step unmounts with the focus in it: hand it to the form's own action, which comes back in its place.
  const cancel = () => {
    const form = box.current?.closest("form");
    const dialog = box.current?.closest("dialog");
    onDone(false);
    requestAnimationFrame(() =>
      (
        form?.querySelector<HTMLElement>('button[type="submit"]') ??
        dialog?.querySelector<HTMLElement>("form button:last-of-type")
      )?.focus(),
    );
  };

  const tryCode = useCallback(
    (full: string) => {
      setChecking(true);
      setError("");
      verifyCode(full)
        .unwrap()
        .then(() => onDone(true))
        .catch(() => setError(COPY.codeFailed))
        .finally(() => setChecking(false));
    },
    [verifyCode, onDone],
  );
  const retry = useFullCode(code, !checking, tryCode);
  const confirmCode = () => {
    if (checking) return;
    if (code.length === CODE_LENGTH) retry();
    else setError(COPY.codeFailed);
  };

  // The api found no login email: nothing can be sent, so only Cancel is left.
  const to = noEmail ? undefined : email;
  const wait = Math.ceil((resendAt - now) / 1000);

  return (
    // Not a form: it sits inside the form it confirms, so Enter confirms here instead of sending that form again.
    <fieldset
      ref={box}
      aria-label={COPY.title}
      className="flex min-w-0 flex-col items-center gap-5 text-center"
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        confirmCode();
      }}
    >
      <StepLead icon={Mail} title={COPY.checkEmail} body={to ? COPY.enterCode(to) : COPY.noEmail} />
      {to ? (
        <div className="flex w-full flex-col items-center gap-2">
          {/* Stays enabled while the code is checked: disabling it would drop keyboard focus. The headline says
              what to enter, so the label is for screen readers. */}
          <CodeInput
            className="w-full items-center [&_label]:sr-only"
            label={COPY.codeLabel}
            length={CODE_LENGTH}
            value={code}
            onValueChange={(digits) => {
              setCode(digits);
              setError("");
            }}
            error={error || undefined}
          />
          {/* The one status line. It stays while a code goes out, so the focus stays on its link. */}
          <p
            aria-live="polite"
            className={`min-h-5 text-sm ${sendFailed || (tooMany && wait > 0) ? "text-danger" : "text-muted"}`}
          >
            {sending && !sent ? (
              COPY.sending
            ) : tooMany && wait > 0 ? (
              <span className="tabular-nums">{COPY.tooMany(COPY.wait(wait))}</span>
            ) : sendFailed ? (
              <>
                {COPY.sendFailed}{" "}
                <Button type="button" variant="link" loading={sending} onClick={resend}>
                  {COPY.tryAgain}
                </Button>
              </>
            ) : sent || tooMany ? (
              <>
                {COPY.notReceived}{" "}
                {wait > 0 ? (
                  <span className="tabular-nums">{COPY.resendIn(wait)}</span>
                ) : (
                  <Button type="button" variant="link" loading={sending} onClick={resend}>
                    {COPY.resend}
                  </Button>
                )}
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      <div className="flex w-full flex-col gap-2">
        {to ? (
          <Button type="button" className="w-full" loading={checking} onClick={confirmCode}>
            {COPY.confirm}
          </Button>
        ) : null}
        <Button type="button" className="w-full" variant={BUTTON_VARIANTS.ghost} onClick={cancel}>
          {COPY.cancel}
        </Button>
      </div>
    </fieldset>
  );
}

/** The time, read again each second until until has passed: the resend countdown ticks without a timer of its own. */
function useNow(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Read again at once, so a wait already over never shows a second left.
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}
