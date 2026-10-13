"use client";

import { BrandIcon, Button, CodeInput, TextField } from "@forwend/ui-web";
import { useLoginWithEmail, useLoginWithOAuth, useLoginWithPasskey } from "@privy-io/react-auth";
import { Fingerprint } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  CODE_LENGTH,
  GOOGLE_PROVIDER,
  SIGN_IN_COPY,
  SIGN_IN_STEPS,
} from "@/features/auth/constants/sign-in";
import type { SignInStep } from "@/features/auth/types/sign-in";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Our own forms on Privy's headless sign-in: an email code, Google (a redirect and back) or a passkey added from the
// checklist. The page moves on to /app once Privy reports the user signed in.
export function SignInForm() {
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { loginWithPasskey } = useLoginWithPasskey();
  const [step, setStep] = useState<SignInStep>(SIGN_IN_STEPS.email);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "code" | "resend" | "passkey">("");
  const [fieldError, setFieldError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  // Google answers after the redirect back, outside our click handler, so its result is read from the flow's own
  // state. (The hook's onError is not used: Privy calls it for every sign-in method, a wrong email code included.)
  const { initOAuth, loading: googleBusy, state: google } = useLoginWithOAuth();
  useEffect(() => {
    if (google.status === "error") setFormError(SIGN_IN_COPY.errors.google);
  }, [google.status]);

  // A full code signs in once, whether typed, pasted or autofilled, also when it arrived during a resend. The Sign in
  // button counts as a new attempt, so it tries the same code again.
  const tried = useRef("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const key = `${attempt}:${code}`;
    if (step !== SIGN_IN_STEPS.code || code.length !== CODE_LENGTH || busy || tried.current === key)
      return;
    tried.current = key;
    setBusy("code");
    setFieldError("");
    setNotice("");
    loginWithCode({ code })
      .catch(() => setFieldError(SIGN_IN_COPY.errors.codeFailed))
      .finally(() => setBusy(""));
  }, [step, code, busy, attempt, loginWithCode]);

  const send = async (resend: boolean) => {
    setBusy(resend ? "resend" : "send");
    setFormError("");
    setNotice("");
    try {
      await sendCode({ email: email.trim() });
      if (resend) {
        setNotice(SIGN_IN_COPY.resent);
      } else {
        setCode("");
        tried.current = "";
        setStep(SIGN_IN_STEPS.code);
      }
    } catch {
      setFormError(SIGN_IN_COPY.errors.sendFailed);
    } finally {
      setBusy("");
    }
  };

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (!EMAIL.test(email.trim())) return setFieldError(SIGN_IN_COPY.errors.email);
    setFieldError("");
    void send(false);
  };

  if (step === SIGN_IN_STEPS.code) {
    return (
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length !== CODE_LENGTH) return setFieldError(SIGN_IN_COPY.errors.code);
          setAttempt((n) => n + 1);
        }}
      >
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-display text-3xl text-balance text-ink sm:text-4xl">
            {SIGN_IN_COPY.codeTitle}
          </h1>
          <p className="text-muted">
            {SIGN_IN_COPY.codeSentTo}{" "}
            <span className="font-medium break-all text-ink">{email.trim()}</span>.
          </p>
        </div>
        {/* Room for the error line is kept, so an error never moves the buttons. The field stays enabled while
            the code is checked: disabling it would drop keyboard focus. */}
        <CodeInput
          label={SIGN_IN_COPY.codeLabel}
          length={CODE_LENGTH}
          value={code}
          onValueChange={(digits) => {
            setCode(digits);
            setFieldError("");
          }}
          error={fieldError || undefined}
          autoFocus
          className="min-h-25"
        />
        <div className="flex flex-col gap-3">
          <Button type="submit" loading={busy === "code"} disabled={busy === "resend"}>
            {SIGN_IN_COPY.signIn}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={busy === "resend"}
            disabled={busy === "code"}
            onClick={() => void send(true)}
          >
            {SIGN_IN_COPY.resend}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={busy !== ""}
            className="self-center"
            onClick={() => {
              setStep(SIGN_IN_STEPS.email);
              setFieldError("");
              setFormError("");
              setNotice("");
            }}
          >
            {SIGN_IN_COPY.otherEmail}
          </Button>
        </div>
        <Messages error={formError} notice={notice} />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="font-display text-3xl text-balance text-ink sm:text-4xl">
          {SIGN_IN_COPY.title}
        </h1>
        <p className="text-balance text-muted">{SIGN_IN_COPY.intro}</p>
      </div>
      <form noValidate className="flex flex-col gap-2" onSubmit={submitEmail}>
        <TextField
          label={SIGN_IN_COPY.emailLabel}
          type="email"
          autoComplete="email"
          placeholder={SIGN_IN_COPY.emailPlaceholder}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldError("");
          }}
          error={fieldError || undefined}
          autoFocus
          className="min-h-26"
        />
        <Button type="submit" loading={busy === "send"} disabled={googleBusy || busy === "passkey"}>
          {SIGN_IN_COPY.sendCode}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-sm text-subtle" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        {SIGN_IN_COPY.or}
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button
        variant="secondary"
        loading={googleBusy}
        disabled={busy !== ""}
        onClick={() => {
          setFormError("");
          initOAuth({ provider: GOOGLE_PROVIDER }).catch(() =>
            setFormError(SIGN_IN_COPY.errors.google),
          );
        }}
      >
        <BrandIcon name="google" className="size-[var(--fw-icon-md)]" />
        {SIGN_IN_COPY.google}
      </Button>
      <Button
        variant="secondary"
        loading={busy === "passkey"}
        disabled={googleBusy || (busy !== "" && busy !== "passkey")}
        onClick={() => {
          setFormError("");
          setBusy("passkey");
          loginWithPasskey()
            .catch(() => setFormError(SIGN_IN_COPY.errors.passkey))
            .finally(() => setBusy(""));
        }}
      >
        <Fingerprint aria-hidden className="size-[var(--fw-icon-md)]" />
        {SIGN_IN_COPY.passkey}
      </Button>
      <Messages error={formError} notice={notice} />
    </div>
  );
}

// Always in the page so screen readers announce a new message, with one line kept for it, so a message never moves
// the form (on phones the form is centered). Keep each message to one line at the form's width.
function Messages({ error, notice }: { error: string; notice: string }) {
  return (
    <div className="min-h-5 text-sm">
      <p role="alert" className="text-danger">
        {error}
      </p>
      <p role="status" className="text-muted">
        {notice}
      </p>
    </div>
  );
}
