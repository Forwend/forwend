"use client";

import {
  Badge,
  BUTTON_VARIANTS,
  Button,
  DetailList,
  DetailRow,
  Dialog,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { useLinkWithPasskey, usePrivy } from "@privy-io/react-auth";
import { Laptop } from "lucide-react";
import { useEffect, useState } from "react";
import { useSignOutEverywhereMutation } from "@/features/auth/api/auth-api";
import { SIGN_OUT_EVERYWHERE_COPY } from "@/features/auth/constants/auth-copy";
import { PRIVY_PASSKEY } from "@/features/onboarding/constants/onboarding";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { deviceName } from "@/screens/settings/lib/device";
import { SplitSection } from "@/shared/components/split-section";

const COPY = SETTINGS_COPY.account;

interface SignInMethod {
  key: string;
  name: string;
  detail: string | null;
}

/** R-137. Privy can't list sessions or end one alone, so this shows what is known: the sign-in methods and this
 * device, with the one way to end every session. */
export function SettingsScreen() {
  const { signOut } = useAppSession();
  const { user } = usePrivy();
  const { linkWithPasskey } = useLinkWithPasskey();
  const toast = useToast();
  const [device, setDevice] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");
  const [everywhere, { isLoading, isError, reset }] = useSignOutEverywhereMutation();
  // The browser's description exists only in the browser, after the first render.
  useEffect(() => setDevice(deviceName(navigator.userAgent)), []);

  const methods = (user?.linkedAccounts ?? []).flatMap((account): SignInMethod[] => {
    if (account.type === "email")
      return [{ key: account.address, name: COPY.methods.email, detail: account.address }];
    if (account.type === "google_oauth")
      return [{ key: `google:${account.email}`, name: COPY.methods.google, detail: account.email }];
    if (account.type === PRIVY_PASSKEY) {
      const where = [account.createdWithBrowser, account.createdWithOs].filter(Boolean).join(", ");
      return [
        {
          key: `passkey:${account.credentialId}`,
          name: COPY.methods.passkey,
          detail: where ? COPY.passkeyMade(where) : null,
        },
      ];
    }
    return [];
  });
  const hasPasskey = methods.some((method) => method.name === COPY.methods.passkey);

  const addPasskey = async () => {
    setPasskeyError("");
    setLinking(true);
    try {
      await linkWithPasskey();
      toast({ tone: TONES.success, title: COPY.passkeyAdded });
    } catch {
      setPasskeyError(COPY.passkeyFailed);
    } finally {
      setLinking(false);
    }
  };
  const endAll = async () => {
    try {
      await everywhere().unwrap();
      await signOut();
    } catch {
      // The dialog shows the error.
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{COPY.title}</h1>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>

      <SplitSection title={COPY.signInWith} description={COPY.signInNote}>
        <div className="fw-panel overflow-hidden">
          <DetailList>
            {methods.map((method) => (
              <DetailRow key={method.key} term={method.name}>
                <span className="break-all">{method.detail}</span>
              </DetailRow>
            ))}
          </DetailList>
          {hasPasskey ? null : (
            <div className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:flex-row sm:items-center sm:px-5">
              <p className="min-w-0 flex-1 text-sm text-muted">{COPY.passkeyHint}</p>
              <Button
                size="sm"
                variant={BUTTON_VARIANTS.secondary}
                loading={linking}
                onClick={() => void addPasskey()}
              >
                {COPY.addPasskey}
              </Button>
            </div>
          )}
          {passkeyError ? (
            <p role="alert" className="px-4 pb-4 text-sm text-danger sm:px-5">
              {passkeyError}
            </p>
          ) : null}
        </div>
      </SplitSection>

      <SplitSection title={COPY.device} description={COPY.deviceNote}>
        <div className="fw-panel overflow-hidden">
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-muted max-sm:hidden">
              <Laptop aria-hidden className="size-[var(--fw-icon-md)]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                {device ?? " "}
                <Badge tone="success">{COPY.current}</Badge>
              </p>
              <p className="text-sm text-muted">{COPY.deviceHint}</p>
            </div>
            <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={() => void signOut()}>
              {COPY.signOut}
            </Button>
          </div>
          <div className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{COPY.everywhere}</p>
              <p className="text-sm text-muted">{COPY.everywhereHint}</p>
            </div>
            <Dialog
              triggerLabel={COPY.everywhere}
              title={SIGN_OUT_EVERYWHERE_COPY.title}
              onClose={reset}
              trigger={(open) => (
                <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={open}>
                  {COPY.everywhere}
                </Button>
              )}
            >
              <p>{SIGN_OUT_EVERYWHERE_COPY.body}</p>
              {isError ? (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {SIGN_OUT_EVERYWHERE_COPY.failed}
                </p>
              ) : null}
              <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
                <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
                  {SIGN_OUT_EVERYWHERE_COPY.keep}
                </Button>
                <Button
                  type="button"
                  variant={BUTTON_VARIANTS.danger}
                  loading={isLoading}
                  onClick={() => void endAll()}
                >
                  {SIGN_OUT_EVERYWHERE_COPY.confirm}
                </Button>
              </form>
            </Dialog>
          </div>
        </div>
      </SplitSection>
    </div>
  );
}
