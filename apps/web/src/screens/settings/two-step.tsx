"use client";

import { Badge, BUTTON_VARIANTS, Button, Dialog, TONES, useToast } from "@forwend/ui-web";
import { type MfaMethod, useMfaEnrollment, usePrivy } from "@privy-io/react-auth";
import { Fingerprint, type LucideIcon, Smartphone } from "lucide-react";
import { useRef, useState } from "react";
import { useMfaStep } from "@/features/auth/components/mfa-step";
import { TwoStepSetup } from "@/features/auth/components/two-step-setup";
import { TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";
import { useWalletMfa } from "@/features/auth/hooks/use-wallet-mfa";
import { mfaCancelled } from "@/features/auth/lib/two-step";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";

const COPY = SETTINGS_COPY.account;
type Method = Extract<MfaMethod, "passkey" | "totp">;

// R-219: each second step Privy can ask for before it signs a send or shows a key, as a row of its own: a passkey and
// an authenticator app. Money moves once both are on, so losing one never locks the owner out (Q-13).
export function TwoStep() {
  const { user } = usePrivy();
  const { required } = useWalletMfa();
  const on = (user?.mfaMethods ?? []).filter((m): m is Method => m === "passkey" || m === "totp");
  return (
    <div className="fw-panel divide-y divide-line overflow-hidden">
      <MethodRow
        method="passkey"
        icon={Fingerprint}
        on={on}
        required={required}
        hint={COPY.passkeyMethodHint}
      />
      <MethodRow
        method="totp"
        icon={Smartphone}
        on={on}
        required={required}
        hint={COPY.appMethodHint}
      />
    </div>
  );
}

function MethodRow({
  method,
  icon: Icon,
  on,
  required,
  hint,
}: {
  method: Method;
  icon: LucideIcon;
  on: Method[];
  required: boolean;
  hint: string;
}) {
  const { unenrollWithPasskey, unenrollWithTotp } = useMfaEnrollment();
  const mfaStep = useMfaStep();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(0);
  const removeBox = useRef<HTMLDivElement>(null);
  const setupBox = useRef<HTMLDivElement>(null);
  const name = TWO_STEP_COPY.methods[method];
  const isOn = on.includes(method);
  const other = on.find((m) => m !== method);

  const remove = async () => {
    setError("");
    setRemoving(true);
    try {
      // Privy asks for two-step first, in place of the buttons; a passkey stays a way to sign in.
      await mfaStep.run(() =>
        method === "passkey" ? unenrollWithPasskey({ removeForLogin: false }) : unenrollWithTotp(),
      );
      removeBox.current?.closest("dialog")?.close();
      toast({ tone: TONES.success, title: COPY.methodRemoved(name) });
    } catch (e) {
      if (!mfaCancelled(e)) setError(COPY.turnOffFailed);
    } finally {
      setRemoving(false);
    }
  };
  const closeSetup = () => setupBox.current?.closest("dialog")?.close();

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-muted max-sm:hidden">
        <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {name}
          {isOn ? <Badge tone="success">{COPY.twoStepOn}</Badge> : null}
        </p>
        <p className="text-sm text-muted">{!isOn && required ? COPY.twoStepNeeded : hint}</p>
        {isOn && method === "totp" ? (
          <p className="text-sm text-muted">{COPY.twoStepLost}</p>
        ) : null}
      </div>
      {isOn ? (
        <Dialog
          triggerLabel={`${COPY.remove} ${name.toLowerCase()}`}
          title={COPY.removeMethodTitle(name)}
          onClose={() => {
            mfaStep.cancel();
            setError("");
          }}
          trigger={(open) => (
            <Button
              size="sm"
              variant={BUTTON_VARIANTS.secondary}
              aria-label={`${COPY.remove} ${name.toLowerCase()}`}
              onClick={open}
            >
              {COPY.remove}
            </Button>
          )}
        >
          <div ref={removeBox}>
            <p>
              {required
                ? COPY.turnOffRequired
                : other
                  ? COPY.removeMethodLeft(TWO_STEP_COPY.methods[other])
                  : COPY.turnOffOptional}
            </p>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-5">
              {mfaStep.step ?? (
                <form method="dialog" className="flex flex-wrap justify-end gap-2">
                  <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
                    {COPY.keepOn}
                  </Button>
                  <Button
                    type="button"
                    variant={BUTTON_VARIANTS.danger}
                    loading={removing}
                    onClick={() => void remove()}
                  >
                    {COPY.remove}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </Dialog>
      ) : null}
      {/* Mounted whatever the state: Privy turns the method on before the setup has recorded it with Forwend. */}
      <Dialog
        triggerLabel={`${COPY.setUp} ${name.toLowerCase()}`}
        // Beside a method already on, this adds one, and its first step asks for the one on.
        title={on.length > 0 ? COPY.addMethod(name) : TWO_STEP_COPY.setUp}
        onClose={() => setSetup(0)}
        trigger={(open) =>
          isOn ? null : (
            <Button
              size="sm"
              variant={on.length > 0 ? BUTTON_VARIANTS.secondary : BUTTON_VARIANTS.primary}
              aria-label={`${COPY.setUp} ${name.toLowerCase()}`}
              onClick={() => {
                setSetup((n) => n + 1);
                open();
              }}
            >
              {COPY.setUp}
            </Button>
          )
        }
      >
        <div ref={setupBox}>
          {setup > 0 ? (
            <TwoStepSetup key={setup} only={method} onDone={closeSetup} onCancel={closeSetup} />
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
