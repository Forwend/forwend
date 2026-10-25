"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SelectField,
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ellipsis, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useRevokeKeyMutation, useRollKeyMutation } from "@/features/api-keys/api/api-keys-api";
import { DEFAULT_OVERLAP_HOURS, OVERLAP_HOURS } from "@/features/api-keys/constants/api-keys";
import { API_KEYS_COPY as COPY } from "@/features/api-keys/constants/api-keys-copy";
import type { ApiKey } from "@/features/api-keys/types/api-keys";

export interface KeyActionsProps {
  profileId: string;
  apiKey: ApiKey;
  /** Gets the new key's text after a roll. The list shows it: with no overlap this row is gone by then. */
  onRolled: (secret: string) => void;
}

// R-144: rolling needs a fresh sign-in, which the API asks for (D-63); revoking does not.
export function KeyActions({ profileId, apiKey, onRolled }: KeyActionsProps) {
  const [roll, rolling] = useRollKeyMutation();
  const [revoke, revoking] = useRevokeKeyMutation();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  // Which dialog opens once the menu has closed and handed focus back (as on Remove member).
  const chosen = useRef<"roll" | "revoke" | null>(null);
  const [overlap, setOverlap] = useState(String(DEFAULT_OVERLAP_HOURS));
  const resetRoll = () => {
    setOverlap(String(DEFAULT_OVERLAP_HOURS));
    rolling.reset();
  };
  const submitRoll = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const pending = roll({ profileId, keyId: apiKey.keyId, overlapHours: Number(overlap) });
      const made = await pending.unwrap();
      onRolled(made.secret);
      // The answer held the secret: drop it from the store too. The hook's reset would be this render's, a no-op.
      pending.reset();
      form.current?.closest("dialog")?.close();
    } catch {
      // The dialog shows the error.
    }
  };
  const confirmRevoke = async () => {
    try {
      await revoke({ profileId, keyId: apiKey.keyId }).unwrap();
      toast({ tone: TONES.success, title: COPY.revoked(apiKey.name) });
    } catch {
      // The dialog shows the error.
    }
  };
  const close = () => form.current?.closest("dialog")?.close();

  return (
    <Dialog
      triggerLabel={COPY.revoke}
      title={COPY.revokeTitle(apiKey.name, apiKey.last4)}
      onClose={revoking.reset}
      trigger={(openRevoke) => (
        <Dialog
          triggerLabel={COPY.roll}
          title={COPY.rollTitle(apiKey.name, apiKey.last4)}
          onClose={resetRoll}
          trigger={(openRoll) => (
            <Menu>
              <MenuTrigger asChild>
                <IconButton
                  label={COPY.actions(apiKey.name, apiKey.last4)}
                  title={COPY.actions(apiKey.name, apiKey.last4)}
                  size="md"
                >
                  <Ellipsis aria-hidden className="size-[var(--fw-icon-md)]" />
                </IconButton>
              </MenuTrigger>
              <MenuContent
                align="end"
                className="w-56"
                onCloseAutoFocus={(event) => {
                  const open = chosen.current;
                  if (!open) return;
                  chosen.current = null;
                  event.preventDefault();
                  if (open === "revoke") return openRevoke();
                  openRoll();
                }}
              >
                {/* A rolled key has its new one already; that one rolls next. */}
                {apiKey.expiresAt ? null : (
                  <MenuItem
                    onSelect={() => {
                      chosen.current = "roll";
                    }}
                  >
                    <RefreshCw aria-hidden className="size-[var(--fw-icon-sm)]" />
                    {COPY.roll}
                  </MenuItem>
                )}
                <MenuItem
                  className="text-danger data-[highlighted]:bg-danger-soft"
                  onSelect={() => {
                    chosen.current = "revoke";
                  }}
                >
                  <Trash2 aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COPY.revoke}
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        >
          <form ref={form} onSubmit={submitRoll} noValidate className="flex flex-col gap-4">
            <p>{COPY.rollBody}</p>
            <SelectField
              label={COPY.overlap}
              value={overlap}
              onValueChange={setOverlap}
              options={OVERLAP_HOURS.map((h) => ({
                value: String(h),
                label: COPY.overlapLabels[h],
              }))}
            />
            {rolling.isError ? (
              <p role="alert" className="text-sm text-danger">
                {COPY.errors.failed}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant={BUTTON_VARIANTS.secondary} onClick={close}>
                {COPY.cancel}
              </Button>
              <Button type="submit" loading={rolling.isLoading}>
                {COPY.rollSubmit}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    >
      <p>{COPY.revokeBody}</p>
      {revoking.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {COPY.errors.revokeFailed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.keep}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={revoking.isLoading}
          onClick={() => void confirmRevoke()}
        >
          {COPY.revoke}
        </Button>
      </form>
    </Dialog>
  );
}
