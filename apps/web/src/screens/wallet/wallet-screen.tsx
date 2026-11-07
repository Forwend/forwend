"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  EmptyState,
  ReceiveAddress,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { useExportWallet } from "@privy-io/react-auth";
import { KeyRound, WalletMinimal } from "lucide-react";
import { useRef, useState } from "react";
import { useCheckFreshSignInMutation } from "@/features/auth/api/auth-api";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import { useMfaStep } from "@/features/auth/components/mfa-step";
import { TwoStepSetup } from "@/features/auth/components/two-step-setup";
import { TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";
import { useWalletMfa } from "@/features/auth/hooks/use-wallet-mfa";
import { mfaCancelled } from "@/features/auth/lib/two-step";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { SplitSection } from "@/shared/components/split-section";

const COPY = SETTINGS_COPY.wallet;
// Privy rejects with only this message, no code, when the owner closes its window while it still connects.
const CLOSED_WHILE_CONNECTING = "User exited before wallet could be connected";

// R-218: the owner exports this profile's wallet key. A short warning comes first, then Privy's own export page for this
// wallet: the key loads on Privy's domain, so Forwend never sees it. With two-step set up, Privy asks for it first, in
// this dialog (D-49). Without it, Confirm it's you comes first for a stale session; that binds this page only, as a
// stolen session could call Privy's export itself (Q-13).
export function WalletScreen() {
  const { profile } = useAppSession();
  const address = profile.walletAddress;
  const { exportWallet } = useExportWallet();
  const [check] = useCheckFreshSignInMutation();
  const fresh = useFreshSignIn();
  const mfa = useWalletMfa();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [settingUp, setSettingUp] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // Privy's window, opened under this one, shows the key once Privy takes the two-step answer.
  const mfaStep = useMfaStep({
    onVerified: () => {
      setOpening(false);
      body.current?.closest("dialog")?.close();
    },
  });
  const quiet = (e: unknown) =>
    mfaCancelled(e) || (e instanceof Error && e.message === CLOSED_WHILE_CONNECTING);

  const show = async () => {
    if (!address) return;
    // R-219: until two-step is set up, the warning sets it up in place, then offers Show the key.
    if (mfa.needed) {
      setSettingUp(true);
      return;
    }
    setError("");
    setOpening(true);
    // Privy asks for two-step before it shows the key: the ask takes the place of these buttons. Privy may not settle
    // its promise when its window closes, so nothing waits on it here.
    if (mfa.enrolled) {
      void mfaStep
        .run(() => exportWallet({ address }))
        .catch((e: unknown) => {
          if (!quiet(e)) setError(COPY.failed);
        })
        .finally(() => setOpening(false));
      return;
    }
    // Without two-step, Confirm it's you comes first for a stale session.
    try {
      await fresh.run(() => check().unwrap());
    } catch (e) {
      if (!fresh.cancelled(e)) setError(COPY.failed);
      setOpening(false);
      return;
    }
    // Privy's window opens over the app: the warning closes first, so no dialog sits under it, and an error from
    // Privy shows as a toast, where it can be seen. Privy may not settle its promise when its window is closed, so the
    // button stops loading here, not after it.
    body.current?.closest("dialog")?.close();
    setOpening(false);
    try {
      await exportWallet({ address });
    } catch (e) {
      if (!quiet(e)) {
        toast({ tone: TONES.danger, title: COPY.failed });
      }
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{COPY.title}</h1>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
      {!address ? (
        <EmptyState compact icon={WalletMinimal} title={COPY.noWallet} />
      ) : (
        <>
          <SplitSection title={COPY.address} description={COPY.addressNote}>
            <ReceiveAddress address={address} label={COPY.yourAddress} />
          </SplitSection>
          <SplitSection title={COPY.key} description={COPY.keyNote}>
            <div className="fw-panel flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-muted max-sm:hidden">
                <KeyRound aria-hidden className="size-[var(--fw-icon-md)]" />
              </span>
              <p className="min-w-0 flex-1 text-sm text-muted">{COPY.exportHint}</p>
              <Dialog
                triggerLabel={COPY.export}
                title={settingUp ? TWO_STEP_COPY.setUp : COPY.warningTitle}
                onClose={() => {
                  fresh.cancel();
                  mfaStep.cancel();
                  setSettingUp(false);
                  setError("");
                }}
                trigger={(open) => (
                  <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={open}>
                    {COPY.export}
                  </Button>
                )}
              >
                <div ref={body}>
                  <p>{COPY.warningBody}</p>
                  {error ? (
                    <p role="alert" className="mt-3 text-sm text-danger">
                      {error}
                    </p>
                  ) : null}
                  {mfa.needed && !settingUp ? (
                    <p className="mt-3 text-sm">{COPY.setUpMfa}</p>
                  ) : null}
                  {/* Each ask takes the place of the dialog's buttons, as in other protected dialogs: the setup,
                      two-step, or Confirm it's you. */}
                  <div className="mt-5">
                    {settingUp ? (
                      <TwoStepSetup
                        onDone={() => setSettingUp(false)}
                        onCancel={() => setSettingUp(false)}
                      />
                    ) : (
                      (fresh.step ??
                      mfaStep.step ?? (
                        <form method="dialog" className="flex flex-wrap justify-end gap-2">
                          <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
                            {COPY.cancel}
                          </Button>
                          <Button
                            type="button"
                            variant={mfa.needed ? BUTTON_VARIANTS.primary : BUTTON_VARIANTS.danger}
                            loading={opening}
                            onClick={() => void show()}
                          >
                            {mfa.needed ? TWO_STEP_COPY.setUp : COPY.show}
                          </Button>
                        </form>
                      ))
                    )}
                  </div>
                </div>
              </Dialog>
            </div>
          </SplitSection>
        </>
      )}
    </div>
  );
}
