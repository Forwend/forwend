"use client";

import {
  BUTTON_VARIANTS,
  Button,
  COPY_STATUS,
  CodeInput,
  QrCode,
  TONES,
  useCopy,
  useToast,
} from "@forwend/ui-web";
import {
  errorIndicatesMfaVerificationFailed,
  useMfa,
  useMfaEnrollment,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { Fingerprint, ShieldCheck, Smartphone } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  useCheckFreshSignInMutation,
  useRecordTwoStepMutation,
} from "@/features/auth/api/auth-api";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import { useMfaStep } from "@/features/auth/components/mfa-step";
import { StepLead } from "@/features/auth/components/step-lead";
import { TWO_STEP_COPY as COPY, FRESH_SIGN_IN_COPY } from "@/features/auth/constants/auth-copy";
import { CODE_LENGTH } from "@/features/auth/constants/sign-in";
import { useAddPasskey } from "@/features/auth/hooks/use-add-passkey";
import { useFullCode } from "@/features/auth/hooks/use-full-code";
import { PasskeyOnDevice, tappedPasskey } from "@/features/auth/lib/passkeys";
import { mfaCancelled } from "@/features/auth/lib/two-step";

type Method = "passkey" | "totp";

export interface TwoStepSetupProps {
  /** One method only, as a row of Account and security sets it up; without, every method not on yet. */
  only?: Method;
  onDone: () => void;
  onCancel: () => void;
}

// R-219: the second steps Privy asks for before it signs or shows a key, set up in place, as a step of the form that
// needs them: the passkey first, then the authenticator app, so one lost still confirms and removes the other. A stale
// session confirms it's you once, before anything changes. Forwend records the methods at the end: only recorded ones
// stand in for the emailed code on a send (D-49), so one a stolen session sets up at Privy alone changes nothing.
export function TwoStepSetup({ only, onDone, onCancel }: TwoStepSetupProps) {
  const { user } = usePrivy();
  const { refreshUser } = useUser();
  const { submitEnrollmentWithPasskey, initEnrollmentWithTotp } = useMfaEnrollment();
  const { promptMfa } = useMfa();
  const mfaStep = useMfaStep();
  const addPasskey = useAddPasskey();
  const [check] = useCheckFreshSignInMutation();
  const [record] = useRecordTwoStepMutation();
  const fresh = useFreshSignIn();
  const toast = useToast();
  const on = user?.mfaMethods ?? [];
  // What this setup turns on, fixed as it opens; the step is the first of them not on yet.
  const [plan] = useState<Method[]>(() =>
    only ? [only] : (["passkey", "totp"] as Method[]).filter((m) => !on.includes(m)),
  );
  const step = plan.find((m) => !on.includes(m));
  const passkeys = (user?.linkedAccounts ?? []).flatMap((a) =>
    a.type === "passkey" ? [a.credentialId] : [],
  );
  // A method added beside another needs that one first. Privy asks for it itself when adding a passkey; when adding
  // the app it answers with an error, so the existing method is asked for here, in place, and the call made again.
  const withTwoStep = async <T,>(act: () => Promise<T>): Promise<T> => {
    try {
      return await mfaStep.run(act);
    } catch (e) {
      if (!errorIndicatesMfaVerificationFailed(e)) throw e;
      await mfaStep.run(promptMfa);
      return mfaStep.run(act);
    }
  };
  const [totp, setTotp] = useState<{ secret: string; authUrl: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  // None of the account's passkeys is on this device: the owner makes one here instead.
  const [makeNew, setMakeNew] = useState(false);
  const confirmed = useRef(false);

  const save = async () => {
    setWorking(true);
    try {
      await fresh.run(() => record(on).unwrap());
      toast({ tone: TONES.success, title: COPY.on });
      onDone();
    } catch {
      setUnsaved(true);
    } finally {
      setWorking(false);
    }
  };
  // Confirm it's you once, before anything changes; giving it up leaves the setup.
  const run = async (work: () => Promise<void>, failure: string) => {
    setError("");
    setWorking(true);
    try {
      if (!confirmed.current) {
        try {
          await fresh.run(() => check().unwrap());
          confirmed.current = true;
        } catch (e) {
          if (fresh.cancelled(e)) onCancel();
          else setError(COPY.startFailed);
          return;
        }
      }
      await work();
    } catch (e) {
      // Giving up the two-step ask leaves the setup, as giving up Confirm it's you does.
      if (mfaCancelled(e)) onCancel();
      else if (e instanceof PasskeyOnDevice) {
        // The passkey is on this device after all: back to the tap, with the reason.
        setMakeNew(false);
        setError(e.message);
      } else setError(failure);
    } finally {
      setWorking(false);
    }
  };
  // Only a passkey the owner shows here turns on: the one they tap on this device, or the one they make now. Privy turns
  // on whatever IDs it is given with no tap, so every linked passkey would take one a stolen session linked too (D-49).
  // removeForLogin would unlink it as a way to sign in. Privy's user is read again after, so the next step sees it.
  const turnOnPasskey = () =>
    run(async () => {
      const id =
        passkeys.length > 0 && !makeNew
          ? await tappedPasskey(passkeys)
          : await addPasskey(fresh.run);
      if (!id) throw new Error("no passkey made");
      await withTwoStep(() =>
        submitEnrollmentWithPasskey({ credentialIds: [id] }, { removeForLogin: false }),
      );
      await refreshUser();
    }, COPY.passkeyFailed);
  const startApp = () =>
    run(async () => {
      setTotp(await withTwoStep(initEnrollmentWithTotp));
    }, COPY.startFailed);
  const begin = (m: Method) => (m === "passkey" ? turnOnPasskey() : startApp());

  // The app's step starts on its own, once. The passkey waits for its button: a browser shows one only on a click.
  const started = useRef<Method | null>(null);
  useEffect(() => {
    if (step !== "totp" || started.current === step) return;
    started.current = step;
    void begin(step);
  });
  // Every step done: Forwend records the methods, once.
  const recorded = useRef(false);
  useEffect(() => {
    if (step || recorded.current) return;
    recorded.current = true;
    void save();
  });

  // The action on top, full width, and the quiet way out under it, as in the two-step ask. The way out stays open
  // while Privy works: leaving drops what it answers.
  const actions = (leave: string, action?: ReactNode) => (
    <div className="flex w-full flex-col gap-2">
      {action}
      <Button type="button" className="w-full" variant={BUTTON_VARIANTS.ghost} onClick={onCancel}>
        {leave}
      </Button>
    </div>
  );
  const failure = error ? (
    <p role="alert" className="text-center text-sm text-danger">
      {error}
    </p>
  ) : null;

  let body: ReactNode;
  if (fresh.step) body = fresh.step;
  else if (mfaStep.step) body = mfaStep.step;
  else if (unsaved) {
    // Privy has them on already: only Forwend's record is missing, so this is no alarm.
    body = (
      <>
        <StepLead icon={ShieldCheck} title={COPY.savedTitle} body={COPY.recordFailed} />
        {actions(
          COPY.notNow,
          <Button type="button" className="w-full" loading={working} onClick={() => void save()}>
            {COPY.tryAgain}
          </Button>,
        )}
      </>
    );
  } else if (step === "totp" && totp)
    body = (
      <AppCode totp={totp} onEnrolled={async () => void (await refreshUser())} actions={actions} />
    );
  else if (step === "passkey" && !working) {
    const make = passkeys.length === 0 || makeNew;
    body = (
      <>
        <StepLead
          icon={Fingerprint}
          title={make ? COPY.createPasskeyTitle : COPY.tapPasskeyTitle}
          body={make ? COPY.createPasskeyBody : COPY.tapPasskeyBody}
        />
        {failure}
        {error && !make ? (
          <Button
            type="button"
            size="sm"
            variant={BUTTON_VARIANTS.link}
            className="-mt-2 text-sm"
            onClick={() => {
              setMakeNew(true);
              setError("");
            }}
          >
            {COPY.createPasskeyInstead}
          </Button>
        ) : null}
        {actions(
          FRESH_SIGN_IN_COPY.cancel,
          <Button type="button" className="w-full" onClick={() => void turnOnPasskey()}>
            <Fingerprint aria-hidden className="size-[var(--fw-icon-sm)]" />
            {make ? COPY.createPasskey : COPY.usePasskey}
          </Button>,
        )}
      </>
    );
  } else {
    body = (
      <>
        <StepLead
          icon={step === "totp" ? Smartphone : step === "passkey" ? Fingerprint : ShieldCheck}
          title={COPY.startingTitle}
          body={step === "totp" ? COPY.starting : COPY.passkeyStarting}
        />
        {failure}
        {/* The buttons of the view that follows, the main one busy until it is ready, so nothing jumps. */}
        {actions(
          FRESH_SIGN_IN_COPY.cancel,
          <Button
            type="button"
            className="w-full"
            loading={!error || working}
            onClick={() => {
              if (step) void begin(step);
            }}
          >
            {error ? COPY.tryAgain : COPY.startingTitle}
          </Button>,
        )}
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-center gap-5">
      {plan.length > 1 && step ? (
        <p className="text-xs font-medium text-muted">
          {COPY.stepOf(plan.indexOf(step) + 1, plan.length)}
        </p>
      ) : null}
      {body}
    </div>
  );
}

// The app's QR code, its key with Copy, then one code from the app turns it on.
function AppCode({
  totp,
  onEnrolled,
  actions,
}: {
  totp: { secret: string; authUrl: string };
  onEnrolled: () => Promise<void>;
  actions: (leave: string, action?: ReactNode) => ReactNode;
}) {
  const { submitEnrollmentWithTotp } = useMfaEnrollment();
  const [copyStatus, copy] = useCopy(totp.secret);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const retry = useFullCode(code, !checking, (full) => {
    setChecking(true);
    setError("");
    // The two-step answer that started this setup still holds. Privy fails a wrong code as it fails a missing answer,
    // so asking for two-step again here would answer a typo with the passkey.
    submitEnrollmentWithTotp({ mfaCode: full })
      .then(onEnrolled, () => {
        setCode("");
        setError(COPY.wrongCode);
        box.current?.querySelector("input")?.focus();
      })
      .finally(() => setChecking(false));
  });
  return (
    <div ref={box} className="flex w-full flex-col items-center gap-5">
      <StepLead icon={Smartphone} title={COPY.scanTitle} body={COPY.scan} />
      {/* Always dark on light, as QrCode draws it; the frame keeps it apart from the dark surface. */}
      <QrCode value={totp.authUrl} label={COPY.qrLabel} className="w-44 rounded-lg" />
      {/* On a phone the app is on this device: the link hands it the key, with nothing to scan. */}
      <a
        href={totp.authUrl}
        className="-mt-2 text-sm font-medium text-ink underline underline-offset-4 sm:hidden"
      >
        {COPY.openApp}
      </a>
      <div className="flex w-full flex-col gap-2">
        <p className="text-sm text-muted">{COPY.noScan}</p>
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
          <code className="min-w-0 flex-1 font-mono text-sm break-all text-ink">
            {totp.secret.match(/.{1,4}/g)?.join(" ")}
          </code>
          <Button
            type="button"
            size="sm"
            variant={BUTTON_VARIANTS.secondary}
            onClick={() => void copy()}
          >
            {copyStatus === COPY_STATUS.copied ? COPY.copied : COPY.copyKey}
          </Button>
        </div>
        <p
          className={
            copyStatus === COPY_STATUS.failed ? "text-sm text-danger" : "text-sm text-muted"
          }
        >
          {copyStatus === COPY_STATUS.failed ? COPY.copyFailed : COPY.saveKey}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 border-t border-line pt-5">
        <p className="text-sm text-muted">{COPY.enterSetupCode}</p>
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
      </div>
      {actions(
        FRESH_SIGN_IN_COPY.cancel,
        <Button
          type="button"
          className="w-full"
          loading={checking}
          onClick={() => (code.length === CODE_LENGTH ? retry() : setError(COPY.wrongCode))}
        >
          {COPY.turnOn}
        </Button>,
      )}
    </div>
  );
}
