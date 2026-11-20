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
import { ChevronRight, KeyRound, WalletMinimal } from "lucide-react";
import { useRef, useState } from "react";
import { useCheckFreshSignInMutation } from "@/features/auth/api/auth-api";
import { TwoStepSetup } from "@/features/auth/components/two-step-setup";
import { TWO_STEP_COPY } from "@/features/auth/constants/auth-copy";
import { useFreshSignIn } from "@/features/auth/hooks/use-fresh-sign-in";
import { useMfaStep } from "@/features/auth/hooks/use-mfa-step";
import { useWalletMfa } from "@/features/auth/hooks/use-wallet-mfa";
import { mfaCancelled } from "@/features/auth/lib/two-step";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { SETTINGS_ROW, SETTINGS_TITLE, SettingsGroup } from "@/shared/components/settings-group";

const COPY = SETTINGS_COPY.wallet;
// Privy rejects with only this message, no code, when the owner closes its window while it still connects.
const CLOSED_WHILE_CONNECTING = "User exited before wallet could be connected";

// The key loads on Privy's domain: Forwend never sees it. Confirm it's you guards this page only.
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
    if (mfa.needed) {
      setSettingUp(true);
      return;
    }
    setError("");
    setOpening(true);
    // Privy may not settle its promise when its window closes, so nothing waits on it here.
    if (mfa.enrolled) {
      void mfaStep
        .run(() => exportWallet({ address }))
        .catch((e: unknown) => {
          if (!quiet(e)) setError(COPY.failed);
        })
        .finally(() => setOpening(false));
      return;
    }
    try {
      await fresh.run(() => check().unwrap());
    } catch (e) {
      if (!fresh.cancelled(e)) setError(COPY.failed);
      setOpening(false);
      return;
    }
    // Privy's window opens over the app, so the dialog closes first and errors go to a toast.
    // Privy may not settle its promise when its window closes, so loading stops before the call.
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
    <div className="flex flex-col gap-6">
      <h1 className={SETTINGS_TITLE}>{COPY.title}</h1>
      {!address ? (
        <EmptyState compact icon={WalletMinimal} title={COPY.noWallet} />
      ) : (
        <>
          <SettingsGroup note={COPY.addressNote}>
            <ReceiveAddress address={address} label={COPY.yourAddress} />
          </SettingsGroup>
          <SettingsGroup note={COPY.exportHint}>
            <div className="fw-panel overflow-hidden">
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
                  <button
                    type="button"
                    onClick={open}
                    className={`${SETTINGS_ROW} w-full text-left text-sm font-medium text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
                  >
                    <KeyRound
                      aria-hidden
                      className="size-[var(--fw-icon-md)] shrink-0 text-muted"
                    />
                    <span className="min-w-0 flex-1">{COPY.export}</span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </button>
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
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
