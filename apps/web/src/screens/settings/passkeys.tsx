"use client";

import { Badge, BUTTON_VARIANTS, Button, Dialog, TONES, useToast } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { Fingerprint } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useCheckFreshSignInMutation } from "@/features/auth/api/auth-api";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import { useAddPasskey } from "@/features/auth/hooks/use-add-passkey";
import { forgetOnDevice, PasskeyOnDevice } from "@/features/auth/lib/passkeys";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { canRemovePasskey, type PasskeyRow, passkeysOf } from "@/screens/settings/lib/passkeys";
import { SETTINGS_ROW } from "@/shared/components/settings-group";
import { shortDate } from "@/shared/lib/dates";

const COPY = SETTINGS_COPY.account;

// R-217: each passkey with where it was made, when it was added and last used; another can be added at any time and
// one removed behind a dialog. Privy makes both changes in the browser, so the api is asked first whether this session
// is fresh: a stale one confirms it's you in place. That binds Forwend's screens, not Privy's own API (Q-13).
export function Passkeys() {
  const { user } = usePrivy();
  const accounts = user?.linkedAccounts ?? [];
  const passkeys = passkeysOf(accounts);
  const removable = canRemovePasskey(accounts);
  const addPasskey = useAddPasskey();
  const fresh = useFreshSignIn();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  // A removed row takes its dialog with it: the focus goes to Add a passkey, not to the page.
  const addArea = useRef<HTMLDivElement>(null);

  const add = async () => {
    setError("");
    setAdding(true);
    try {
      await addPasskey(fresh.run);
      toast({ tone: TONES.success, title: COPY.passkeyDone });
    } catch (e) {
      if (!fresh.cancelled(e))
        setError(e instanceof PasskeyOnDevice ? e.message : COPY.passkeyFailed);
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      {passkeys.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line">
          {passkeys.map((p) => (
            <PasskeyItem
              key={p.credentialId}
              passkey={p}
              removable={removable}
              onRemoved={() =>
                requestAnimationFrame(() => addArea.current?.querySelector("button")?.focus())
              }
            />
          ))}
        </ul>
      ) : null}
      <div ref={addArea} className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:px-5">
        {fresh.step ?? (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted">
              {passkeys.length > 0 ? null : COPY.passkeyHint}
            </p>
            <Button
              size="sm"
              variant={BUTTON_VARIANTS.secondary}
              loading={adding}
              onClick={() => void add()}
            >
              {COPY.addPasskey}
            </Button>
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

function PasskeyItem({
  passkey,
  removable,
  onRemoved,
}: {
  passkey: PasskeyRow;
  removable: boolean;
  onRemoved: () => void;
}) {
  const { unlinkPasskey } = usePrivy();
  const [check] = useCheckFreshSignInMutation();
  const fresh = useFreshSignIn();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const name = passkey.name ?? COPY.methods.passkey;
  // Two passkeys with no name read apart by where they were made.
  const label = COPY.removeLabel(passkey.madeOn ? COPY.namedOn(name, passkey.madeOn) : name);
  const reasonId = useId();
  // Privy leaves two-step on with nothing to answer it when its passkey goes, so that one stays until two-step is off.
  const blocked = !removable ? COPY.onlyWay : passkey.twoStep ? COPY.twoStepPasskey : null;
  const meta = [
    passkey.madeOn,
    passkey.lastUsed
      ? COPY.passkeyUsed(shortDate(passkey.lastUsed.toISOString()))
      : passkey.added
        ? COPY.passkeyAdded(shortDate(passkey.added.toISOString()))
        : null,
  ].filter(Boolean);

  // The row leaves the list once Privy has removed it, and its dialog with it.
  const remove = async () => {
    setError("");
    setRemoving(true);
    try {
      await fresh.run(() => check().unwrap());
      await unlinkPasskey(passkey.credentialId);
      forgetOnDevice(passkey.credentialId);
      toast({ tone: TONES.success, title: COPY.removed });
      onRemoved();
    } catch (e) {
      if (!fresh.cancelled(e)) setError(COPY.removeFailed);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <li className={SETTINGS_ROW}>
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-muted max-sm:hidden">
        <Fingerprint aria-hidden className="size-[var(--fw-icon-md)]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {name}
          {passkey.twoStep ? <Badge>{COPY.twoStepBadge}</Badge> : null}
        </p>
        <p className="text-sm text-muted">{meta.join(" · ")}</p>
        {blocked ? (
          <p id={reasonId} className="text-sm text-muted">
            {blocked}
          </p>
        ) : null}
      </div>
      <Dialog
        triggerLabel={label}
        title={COPY.removeTitle}
        onClose={() => {
          fresh.cancel();
          setError("");
        }}
        trigger={(open) => (
          <Button
            size="sm"
            variant={BUTTON_VARIANTS.ghost}
            disabled={blocked !== null}
            aria-label={label}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={open}
          >
            {COPY.remove}
          </Button>
        )}
      >
        <p>{COPY.removeBody}</p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {/* Confirm it's you takes the place of the dialog's buttons, as in other protected dialogs. */}
        <div className="mt-5">
          {fresh.step ?? (
            <form method="dialog" className="flex flex-wrap justify-end gap-2">
              <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
                {COPY.keep}
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
      </Dialog>
    </li>
  );
}
