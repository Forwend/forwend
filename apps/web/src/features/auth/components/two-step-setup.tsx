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
import { StepLead } from "@/features/auth/components/step-lead";
import { TWO_STEP_COPY as COPY } from "@/features/auth/constants/auth-copy";
import { CODE_LENGTH } from "@/features/auth/constants/sign-in";
import { useAddPasskey } from "@/features/auth/hooks/use-add-passkey";
import { useFreshSignIn } from "@/features/auth/hooks/use-fresh-sign-in";
import { useFullCode } from "@/features/auth/hooks/use-full-code";
import { useMfaStep } from "@/features/auth/hooks/use-mfa-step";
import { PasskeyOnDevice, tappedPasskey } from "@/features/auth/lib/passkeys";
import { passkeyIds } from "@/features/auth/lib/privy-user";
import { mfaCancelled } from "@/features/auth/lib/two-step";
import type { TwoStepMethod } from "@/features/auth/types/two-step";

export interface TwoStepSetupProps {
  only?: TwoStepMethod;
  onDone: () => void;
  onCancel: () => void;
}

// Only methods Forwend records replace the emailed code, so one set up at Privy alone changes nothing.
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
  // Fixed as it opens, so turning one on does not change the plan.
  const [plan] = useState<TwoStepMethod[]>(() =>
    only ? [only] : (["passkey", "totp"] as TwoStepMethod[]).filter((m) => !on.includes(m)),
  );
  const step = plan.find((m) => !on.includes(m));
  const passkeys = passkeyIds(user);
  // Privy refuses adding the app until the existing method answers, so ask for it and retry.
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
      if (mfaCancelled(e)) onCancel();
      else if (e instanceof PasskeyOnDevice) {
        setMakeNew(false);
        setError(e.message);
      } else setError(failure);
    } finally {
      setWorking(false);
    }
  };
  // Privy turns on any ID it is given, so only the passkey tapped or made here goes in.
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
  const begin = (m: TwoStepMethod) => (m === "passkey" ? turnOnPasskey() : startApp());

  // A browser shows a passkey prompt only on a click, so only the app step starts by itself.
  const started = useRef<TwoStepMethod | null>(null);
  useEffect(() => {
    if (step !== "totp" || started.current === step) return;
    started.current = step;
    void begin(step);
  });
  const recorded = useRef(false);
  useEffect(() => {
    if (step || recorded.current) return;
    recorded.current = true;
    void save();
  });

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
          COPY.cancel,
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
        {actions(
          COPY.cancel,
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
    // Privy fails a wrong code like a missing answer: asking two-step again would answer a typo.
    submitEnrollmentWithTotp({ mfaCode: full })
      .then(onEnrolled, () => {
        setCode("");
        setError(COPY.wrongCode);
        box.current?.querySelector("input")?.focus();
      })
      .finally(() => setChecking(false));
  });
  return (
    <div ref={box} className="flex w-full flex-col items-center gap-5 text-center">
      <StepLead icon={Smartphone} title={COPY.scanTitle} body={COPY.scan} />
      <QrCode value={totp.authUrl} label={COPY.qrLabel} className="w-40 rounded-lg" />
      <a
        href={totp.authUrl}
        className="-mt-2 text-sm font-medium text-ink underline underline-offset-4 sm:hidden"
      >
        {COPY.openApp}
      </a>
      <div className="flex w-full flex-col gap-2">
        <p className="text-sm text-muted">{COPY.noScan}</p>
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 py-2 pr-2 pl-3 text-left">
          <code className="min-w-0 flex-1 font-mono text-sm text-ink [overflow-wrap:anywhere]">
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
      <div className="flex w-full flex-col border-t border-line pt-5">
        <CodeInput
          className="w-full items-center"
          label={COPY.enterSetupCode}
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
        COPY.cancel,
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
