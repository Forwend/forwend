"use client";

import { BUTTON_VARIANTS, Button, CodeInput, Dialog } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSendFreshCodeMutation, useVerifyFreshCodeMutation } from "@/features/auth/api/auth-api";
import { FRESH_SIGN_IN_COPY as COPY } from "@/features/auth/constants/auth-copy";
import { CODE_LENGTH } from "@/features/auth/constants/sign-in";
import { useFullCode } from "@/features/auth/hooks/use-full-code";
import { type AskFreshSignIn, needsFreshSignIn } from "@/shared/api/fresh-sign-in";

type Answer = (ok: boolean) => void;

/** A form that may ask for a fresh sign-in: the ask opens its step in place of the form's buttons. */
interface Scope {
  open: (answer: Answer) => void;
}

interface Controller {
  claim: (scope: Scope) => void;
  release: (scope: Scope) => void;
}

const FreshSignInContext = createContext<Controller | null>(null);

export interface FreshSignInProviderProps {
  /** Hands over the function the API calls on reauth_required (R-137). */
  register: (ask: AskFreshSignIn) => void;
  children: ReactNode;
}

// R-137: a request that needs a fresh sign-in asks the form that sent it, in place, so no dialog opens on top of
// another and the user still sees what they confirm. A request no form claimed asks in a dialog of its own.
export function FreshSignInProvider({ register, children }: FreshSignInProviderProps) {
  const claimed = useRef<Scope | null>(null);
  const [fallback, setFallback] = useState<{ answer: Answer; asked: number } | null>(null);
  const controller = useMemo<Controller>(
    () => ({
      claim: (scope) => {
        claimed.current = scope;
      },
      release: (scope) => {
        if (claimed.current === scope) claimed.current = null;
      },
    }),
    [],
  );
  useEffect(
    () =>
      register(
        () =>
          new Promise<boolean>((resolve) => {
            if (claimed.current) claimed.current.open(resolve);
            else setFallback((f) => ({ answer: resolve, asked: (f?.asked ?? 0) + 1 }));
          }),
      ),
    [register],
  );
  return (
    <FreshSignInContext.Provider value={controller}>
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

/** For a form whose request may need a fresh sign-in: run sends it, and step is what to show in place of the form's
 * buttons while the user confirms. pending is true then; the form's fields should stay as they were. */
/** titled is false where the step sits under a heading that already says Confirm it's you. */
export function useFreshSignIn({ titled = true }: { titled?: boolean } = {}) {
  const controller = useContext(FreshSignInContext);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const scope = useRef<Scope>({ open: (a) => setAnswer(() => a) });
  // A form that unmounts mid-confirm gives up; one whose dialog only closes calls cancel in its onClose.
  useEffect(() => {
    const own = scope.current;
    return () => controller?.release(own);
  }, [controller]);
  const latest = useRef(answer);
  latest.current = answer;
  useEffect(() => () => latest.current?.(false), []);
  const run = useCallback(
    async <T,>(send: () => Promise<T>): Promise<T> => {
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
  const step = answer ? <ConfirmStep onDone={done} titled={titled} /> : null;
  return {
    run,
    step,
    pending: answer !== null,
    // For a dialog's own close: it gives up as the step's Cancel does.
    cancel: () => done(false),
    cancelled: (error: unknown) => gaveUp.current && needsFreshSignIn(error),
  };
}

/** Opens a dialog's open function while a fresh sign-in is pending, for an action that has no form of its own. */
export function useOpenWhilePending(pending: boolean, open: (() => void) | undefined) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (pending) latest.current?.();
  }, [pending]);
}

// A code sent to the login email, as code screens do it: one line says where the code went, the boxes take it, and
// one status line under them says what happens next. In a form it sits under a hairline after the fields, with Cancel
// and Confirm. titled is false where a sheet or dialog title already says Confirm it's you: its Back or Close gives
// up, so only Confirm is left, full width.
function ConfirmStep({
  onDone,
  titled = true,
}: {
  onDone: (ok: boolean) => void;
  titled?: boolean;
}) {
  const { user } = usePrivy();
  // Forwend's own code (R-137): a Privy sign-in made while signed in keeps the session and its sign-in time, so the
  // api can't tell it happened (D-49).
  const [sendCode] = useSendFreshCodeMutation();
  const [verifyCode] = useVerifyFreshCodeMutation();
  // The api sends the code to the login email, or a Google-only account's Google address.
  const email = user?.email?.address ?? user?.google?.email;
  const [noEmail, setNoEmail] = useState(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [error, setError] = useState("");
  // Sending and checking don't wait on each other: a code from an earlier email still works while a new one goes.
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const now = useNow(resendAt);
  const titleId = useId();
  const box = useRef<HTMLFieldSetElement>(null);

  const send = useCallback(async () => {
    if (!email) return;
    setSending(true);
    setSendFailed(false);
    try {
      const { resendAfterSeconds } = await sendCode().unwrap();
      setSent(true);
      setResendAt(Date.now() + resendAfterSeconds * 1000);
    } catch (e) {
      const code = ((e as FetchBaseQueryError).data as { error?: { code?: string } } | undefined)
        ?.error?.code;
      // This session's code sent a moment ago is still the one to enter.
      if (code === "code_sent_recently") setSent(true);
      else if (code === "no_login_email") setNoEmail(true);
      else setSendFailed(true);
    } finally {
      setSending(false);
    }
  }, [email, sendCode]);
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
      aria-labelledby={titled ? titleId : undefined}
      className="flex min-w-0 flex-col gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0"
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        confirmCode();
      }}
    >
      <div className="flex flex-col gap-1">
        {titled ? (
          <p id={titleId} className="text-sm font-semibold text-ink">
            {COPY.title}
          </p>
        ) : null}
        <p className="text-sm break-words text-muted">{to ? COPY.enterCode(to) : COPY.noEmail}</p>
      </div>
      {to ? (
        <div className="flex flex-col gap-2">
          {/* Stays enabled while the code is checked: disabling it would drop keyboard focus. */}
          <CodeInput
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
            className={`min-h-5 text-sm ${sendFailed ? "text-danger" : "text-muted"}`}
          >
            {sending && !sent ? (
              COPY.sending
            ) : sendFailed ? (
              <>
                {COPY.sendFailed}{" "}
                <Button type="button" variant="link" loading={sending} onClick={() => void send()}>
                  {COPY.tryAgain}
                </Button>
              </>
            ) : sent ? (
              <>
                {COPY.notReceived}{" "}
                {wait > 0 ? (
                  <span className="tabular-nums">{COPY.resendIn(wait)}</span>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    loading={sending}
                    onClick={() => void send()}
                  >
                    {COPY.resend}
                  </Button>
                )}
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      {titled ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant={BUTTON_VARIANTS.secondary} onClick={cancel}>
            {COPY.cancel}
          </Button>
          {to ? (
            <Button type="button" loading={checking} onClick={confirmCode}>
              {COPY.confirm}
            </Button>
          ) : null}
        </div>
      ) : to ? (
        <Button type="button" className="w-full" loading={checking} onClick={confirmCode}>
          {COPY.confirm}
        </Button>
      ) : null}
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

// For a request no form claimed. The step mounts only once asked, so its focus lands after the dialog opens.
function FallbackDialog({ asked, open, answer }: { asked: number; open: boolean; answer: Answer }) {
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
          <ConfirmStep
            titled={false}
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

// The dialog opens from a request, not a button: each ask opens it once. open is new on every render, and opening an
// open dialog throws, so only a new ask runs it.
function OpenWhenAsked({ asked, open }: { asked: number; open: () => void }) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (asked > 0) latest.current();
  }, [asked]);
  return null;
}
