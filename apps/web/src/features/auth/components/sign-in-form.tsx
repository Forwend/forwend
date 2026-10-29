"use client";

import { BrandIcon, Button, CodeInput, Form, TextField } from "@forwend/ui-web";
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

// The page moves on to /app once Privy reports the user signed in.
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
  // Google answers after the redirect, so read its result from state; onError fires for every method.
  const { initOAuth, loading: googleBusy, state: google } = useLoginWithOAuth();
  useEffect(() => {
    if (google.status === "error") setFormError(SIGN_IN_COPY.errors.google);
  }, [google.status]);

  // A full code signs in once however it arrived; the Sign in button retries the same code.
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
      <Form
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length !== CODE_LENGTH) return setFieldError(SIGN_IN_COPY.errors.code);
          setAttempt((n) => n + 1);
        }}
      >
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink">
            {SIGN_IN_COPY.codeTitle}
          </h1>
          {/* The address on its own line, so a long one never breaks in the middle of the sentence. */}
          <p className="text-muted">
            {SIGN_IN_COPY.codeSentTo}
            <span className="block font-medium break-words text-ink">{email.trim()}</span>
          </p>
        </div>
        {/* Stays enabled while the code is checked: disabling it would drop keyboard focus. */}
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
        <Button size="lg" type="submit" loading={busy === "code"} disabled={busy === "resend"}>
          {SIGN_IN_COPY.signIn}
        </Button>
        {/* Sign in is the one action; the ways around a missing code stay quiet under it. */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Button
            type="button"
            variant="link"
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
      </Form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink">
          {SIGN_IN_COPY.title}
        </h1>
        <p className="text-balance text-muted">{SIGN_IN_COPY.intro}</p>
      </div>
      <Form onSubmit={submitEmail} gap="sm">
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
        <Button
          size="lg"
          type="submit"
          loading={busy === "send"}
          disabled={googleBusy || busy === "passkey"}
        >
          {SIGN_IN_COPY.sendCode}
        </Button>
      </Form>
      <div className="flex items-center gap-3 text-sm text-subtle" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        {SIGN_IN_COPY.or}
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button
        size="lg"
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
        size="lg"
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

// Always rendered so screen readers announce a change; one reserved line, so keep each message short.
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
