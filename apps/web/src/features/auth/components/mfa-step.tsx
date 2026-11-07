"use client";

import { BUTTON_VARIANTS, Button, CodeInput, Dialog } from "@forwend/ui-web";
import {
  errorIndicatesMaxMfaRetries,
  errorIndicatesMfaTimeout,
  errorIndicatesMfaVerificationFailed,
  type MfaMethod,
  useMfa,
  useRegisterMfaListener,
} from "@privy-io/react-auth";
import { Fingerprint, ShieldAlert, Smartphone } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { OpenWhenAsked } from "@/features/auth/components/fresh-sign-in";
import { StepLead } from "@/features/auth/components/step-lead";
import { TWO_STEP_COPY as COPY, FRESH_SIGN_IN_COPY } from "@/features/auth/constants/auth-copy";
import { CODE_LENGTH } from "@/features/auth/constants/sign-in";
import { useFullCode } from "@/features/auth/hooks/use-full-code";

interface Scope {
  open: (methods: MfaMethod[]) => void;
}

interface Controller {
  claim: (scope: Scope) => void;
  release: (scope: Scope) => void;
}

const MfaContext = createContext<Controller | null>(null);

// D-49, R-219: Privy asks for its MFA before it signs, shows a key or turns MFA off, and shows no window of its own
// (noPromptOnMfaRequired): one would open under Forwend's dialogs. The form that started the action shows the ask in
// place of its buttons, as Confirm it's you does; an ask no form claimed shows in a small dialog of its own.
export function MfaProvider({ children }: { children: ReactNode }) {
  const claimed = useRef<Scope | null>(null);
  const [fallback, setFallback] = useState({ asked: 0, methods: [] as MfaMethod[] });
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
  // One object for good: Privy subscribes again whenever it changes.
  const listener = useMemo(
    () => ({
      onMfaRequired: ({ mfaMethods }: { mfaMethods: MfaMethod[] }) => {
        if (claimed.current) claimed.current.open(mfaMethods);
        else setFallback((f) => ({ asked: f.asked + 1, methods: mfaMethods }));
      },
    }),
    [],
  );
  useRegisterMfaListener(listener);
  return (
    <MfaContext.Provider value={controller}>
      {children}
      <FallbackDialog asked={fallback.asked} methods={fallback.methods} />
    </MfaContext.Provider>
  );
}

/** For a form whose action may need Privy's MFA: run starts the action, and step is what to show in place of the
 * form's buttons while Privy waits for it. busy is true while Privy checks an answer: closing then would cancel
 * nothing, since Privy goes on. onVerified runs once Privy takes the answer. */
export function useMfaStep({ onVerified }: { onVerified?: () => void } = {}) {
  const controller = useContext(MfaContext);
  const { cancel } = useMfa();
  const [methods, setMethods] = useState<MfaMethod[] | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const scope = useRef<Scope>({
    open: (m) => {
      asked.current = true;
      setMethods(m);
    },
  });
  // An action Privy never settles, such as its export window closed early, keeps no claim once it is answered.
  const end = useCallback(() => {
    controller?.release(scope.current);
    asked.current = false;
    setMethods(null);
    setBusy(false);
  }, [controller]);
  // The form went away with Privy still asking, such as the send sheet closed during a setup: the action that asked
  // ends, and the next ask shows where it is made, not in a form no longer there.
  const cancelAsk = useRef(cancel);
  cancelAsk.current = cancel;
  useEffect(
    () => () => {
      controller?.release(scope.current);
      if (asked.current) cancelAsk.current();
    },
    [controller],
  );
  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      controller?.claim(scope.current);
      try {
        return await action();
      } finally {
        end();
      }
    },
    [controller, end],
  );
  const step = methods ? (
    <MfaStep
      methods={methods}
      onBusy={setBusy}
      onVerified={() => {
        end();
        onVerified?.();
      }}
      onCancel={cancel}
    />
  ) : null;
  return { run, step, busy, cancel: () => (methods && !busy ? cancel() : undefined) };
}

// The one ask: the passkey first, one tap, when the user has one for MFA; else, or as well, the app's code.
function MfaStep({
  methods,
  onBusy,
  onVerified,
  onCancel,
}: {
  methods: MfaMethod[];
  onBusy: (busy: boolean) => void;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { init, submit } = useMfa();
  const passkey = methods.includes("passkey");
  const totp = methods.includes("totp");
  // The passkey first, one tap; with an app as well, a link switches to its code.
  const [view, setView] = useState<"passkey" | "totp" | null>(
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

  const switchTo = (next: "passkey" | "totp") => {
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

// For an ask no form claimed. Closing it before Privy took an answer cancels the action that asked.
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
        // Privy goes on with an answer it is checking: the dialog stays until it says.
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
