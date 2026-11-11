"use client";

import { Badge, BUTTON_VARIANTS, Button, DetailList, DetailRow, Dialog } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { Laptop } from "lucide-react";
import { useEffect, useState } from "react";
import { useSignOutEverywhereMutation } from "@/features/auth/api/auth-api";
import { SIGN_OUT_EVERYWHERE_COPY } from "@/features/auth/constants/auth-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { deviceName } from "@/screens/settings/lib/device";
import { Passkeys } from "@/screens/settings/passkeys";
import { TwoStep } from "@/screens/settings/two-step";
import { SETTINGS_ROW, SETTINGS_TITLE, SettingsGroup } from "@/shared/components/settings-group";

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
  const [device, setDevice] = useState<string | null>(null);
  const [everywhere, { isLoading, isError, reset }] = useSignOutEverywhereMutation();
  // The browser's description exists only in the browser, after the first render.
  useEffect(() => setDevice(deviceName(navigator.userAgent)), []);

  const methods = (user?.linkedAccounts ?? []).flatMap((account): SignInMethod[] => {
    if (account.type === "email")
      return [{ key: account.address, name: COPY.methods.email, detail: account.address }];
    if (account.type === "google_oauth")
      return [{ key: `google:${account.email}`, name: COPY.methods.google, detail: account.email }];
    return [];
  });
  const endAll = async () => {
    try {
      await everywhere().unwrap();
      await signOut();
    } catch {
      // The dialog shows the error.
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className={SETTINGS_TITLE}>{COPY.title}</h1>

      <SettingsGroup title={COPY.signInWith}>
        <div className="fw-panel overflow-hidden">
          <DetailList>
            {methods.map((method) => (
              <DetailRow key={method.key} term={method.name}>
                <span className="break-all">{method.detail}</span>
              </DetailRow>
            ))}
          </DetailList>
          {/* Passkeys have rows of their own: where each was made, when it was used, and Remove (R-217). */}
          <Passkeys />
        </div>
      </SettingsGroup>

      <SettingsGroup title={COPY.twoStep} note={COPY.twoStepNote}>
        <TwoStep />
      </SettingsGroup>

      <SettingsGroup title={COPY.device}>
        <div className="fw-panel divide-y divide-line overflow-hidden">
          <div className={SETTINGS_ROW}>
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-muted max-sm:hidden">
              <Laptop aria-hidden className="size-[var(--fw-icon-md)]" />
            </span>
            <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm font-medium text-ink">
              {device ?? " "}
              <Badge tone="success">{COPY.current}</Badge>
            </p>
            <Button size="sm" variant={BUTTON_VARIANTS.secondary} onClick={() => void signOut()}>
              {COPY.signOut}
            </Button>
          </div>
          {/* Wrapped, so the panel's rules see one row and not the closed dialog beside it. */}
          <div>
            <Dialog
              triggerLabel={COPY.everywhere}
              title={SIGN_OUT_EVERYWHERE_COPY.title}
              onClose={reset}
              trigger={(open) => (
                <button
                  type="button"
                  onClick={open}
                  className={`${SETTINGS_ROW} w-full text-left text-sm font-medium text-danger outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
                >
                  {COPY.everywhere}
                </button>
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
      </SettingsGroup>
    </div>
  );
}
