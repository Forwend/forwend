"use client";

import { BUTTON_VARIANTS, Button, CodeInput, Dialog } from "@forwend/ui-web";
import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { FRESH_SIGN_IN_COPY as COPY } from "@/features/auth/constants/auth-copy";
import { CODE_LENGTH } from "@/features/auth/constants/sign-in";
import type { AskFreshSignIn } from "@/shared/api/fresh-sign-in";

export interface FreshSignInProps {
  /** Hands over the function that opens this dialog and answers once the user signed in again or gave up. */
  register: (ask: AskFreshSignIn) => void;
}

// R-137: a new email sign-in while signed in gives a token Privy marks as a sign-in, not a refresh (S-8).
export function FreshSignIn({ register }: FreshSignInProps) {
  const { user } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const email = user?.email?.address;
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [asked, setAsked] = useState(0);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const send = useCallback(async () => {
    if (!email) return;
    setSent(false);
    setError("");
    try {
      await sendCode({ email });
      setSent(true);
    } catch {
      setError(COPY.sendFailed);
    }
  }, [email, sendCode]);

  useEffect(
    () =>
      register(
        () =>
          new Promise<boolean>((resolve) => {
            answer.current = resolve;
            setCode("");
            setAsked((n) => n + 1);
            void send();
          }),
      ),
    [register, send],
  );

  const finish = (ok: boolean) => {
    answer.current?.(ok);
    answer.current = null;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) return setError(COPY.codeFailed);
    setBusy(true);
    setError("");
    try {
      await loginWithCode({ code });
      finish(true);
      form.current?.closest("dialog")?.close();
    } catch {
      setError(COPY.codeFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.title}
      title={COPY.title}
      closeLabel={COPY.close}
      trigger={(open) => <OpenWhenAsked asked={asked} open={open} />}
      onClose={() => finish(false)}
    >
      {email ? (
        <form ref={form} onSubmit={submit} className="flex flex-col gap-4">
          <p>
            {COPY.intro} {sent ? COPY.sentTo(email) : COPY.sending}
          </p>
          <CodeInput
            label={COPY.codeLabel}
            length={CODE_LENGTH}
            value={code}
            onValueChange={(digits) => {
              setCode(digits);
              setError("");
            }}
            error={error || undefined}
            autoFocus
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant={BUTTON_VARIANTS.ghost} onClick={() => void send()}>
              {COPY.resend}
            </Button>
            <Button
              type="button"
              variant={BUTTON_VARIANTS.secondary}
              onClick={() => form.current?.closest("dialog")?.close()}
            >
              {COPY.cancel}
            </Button>
            <Button type="submit" loading={busy}>
              {COPY.confirm}
            </Button>
          </div>
        </form>
      ) : (
        <form method="dialog" className="flex flex-col gap-4">
          <p>{COPY.noEmail}</p>
          <div className="flex justify-end">
            <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
              {COPY.close}
            </Button>
          </div>
        </form>
      )}
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
