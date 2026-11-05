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
  TONES,
  useToast,
} from "@forwend/ui-web";
import { Ellipsis, Trash2, UserCog } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useFreshSignIn } from "@/features/auth/components/fresh-sign-in";
import { ROLE_LABELS, ROLES } from "@/features/profiles/constants/profile";
import type { Store } from "@/features/stores/types/stores";
import { useRemoveMemberMutation, useSetMemberMutation } from "@/features/team/api/team-api";
import { GrantFields } from "@/features/team/components/grant-fields";
import { MEMBER_ROLES } from "@/features/team/constants/team";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import { grantError } from "@/features/team/lib/team";
import type { Member, MemberRole } from "@/features/team/types/team";

export interface MemberActionsProps {
  profileId: string;
  member: Member;
  /** How the member is named: their email, or a placeholder when they have none. */
  who: string;
  stores: readonly Store[];
}

const memberRole = (member: Member): MemberRole =>
  MEMBER_ROLES.find((r) => r === member.role) ?? ROLES.admin;

// D-93: a role change needs a fresh sign-in, which the API asks for (D-63); removing someone does not.
export function MemberActions({ profileId, member, who, stores }: MemberActionsProps) {
  const [setMember, saving] = useSetMemberMutation();
  const fresh = useFreshSignIn();
  const [remove, removing] = useRemoveMemberMutation();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  // Which dialog opens once the menu has closed and handed focus back (as on Delete client).
  const chosen = useRef<"change" | "remove" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [role, setRole] = useState<MemberRole>(memberRole(member));
  const [storeIds, setStoreIds] = useState<string[]>(member.stores);
  const [errors, setErrors] = useState<ReturnType<typeof grantError>>({});
  const resetChange = () => {
    setRole(memberRole(member));
    setStoreIds(member.stores);
    setErrors({});
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (role !== ROLES.admin && storeIds.length === 0)
      return setErrors({ stores: COPY.errors.stores });
    setErrors({});
    try {
      await fresh.run(() =>
        setMember({
          profileId,
          memberId: member.memberId,
          body: { role, stores: role === ROLES.admin ? [] : storeIds },
        }).unwrap(),
      );
      toast({ tone: TONES.success, title: COPY.changed(who, ROLE_LABELS[role]) });
      form.current?.closest("dialog")?.close();
    } catch (failure) {
      if (!fresh.cancelled(failure)) setErrors(grantError(failure));
    }
  };
  const confirmRemove = async () => {
    try {
      await remove({ profileId, memberId: member.memberId }).unwrap();
      toast({ tone: TONES.success, title: COPY.removed(who) });
    } catch {
      // The dialog shows the error.
    }
  };

  return (
    <Dialog
      triggerLabel={COPY.remove}
      title={COPY.removeTitle(who)}
      onClose={removing.reset}
      trigger={(openRemove) => (
        <Dialog
          triggerLabel={COPY.change}
          title={COPY.changeTitle(who)}
          onClose={() => {
            fresh.cancel();
            resetChange();
          }}
          trigger={(openChange) => (
            <Menu>
              <MenuTrigger asChild>
                <IconButton ref={trigger} label={COPY.actions(who)} title={COPY.actions(who)}>
                  <Ellipsis aria-hidden className="size-[var(--fw-icon-sm)]" />
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
                  // The trigger holds focus as the dialog opens, so the dialog hands it back there when it closes.
                  trigger.current?.focus();
                  if (open === "remove") return openRemove();
                  // From the member as the list has it now, which a saved change has updated.
                  resetChange();
                  openChange();
                }}
              >
                <MenuItem
                  onSelect={() => {
                    chosen.current = "change";
                  }}
                >
                  <UserCog aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COPY.change}
                </MenuItem>
                <MenuItem
                  className="text-danger data-[highlighted]:bg-danger-soft"
                  onSelect={() => {
                    chosen.current = "remove";
                  }}
                >
                  <Trash2 aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COPY.remove}
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        >
          <form ref={form} onSubmit={save} noValidate className="flex flex-col gap-4">
            <fieldset disabled={fresh.pending} className="flex min-w-0 flex-col gap-4">
              <GrantFields
                role={role}
                onRole={setRole}
                stores={stores}
                chosen={storeIds}
                onChosen={setStoreIds}
                storesError={errors.stores}
                disabled={fresh.pending}
              />
            </fieldset>
            {errors.form ? (
              <p role="alert" className="text-sm text-danger">
                {errors.form}
              </p>
            ) : null}
            {fresh.step ?? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant={BUTTON_VARIANTS.secondary}
                  onClick={() => form.current?.closest("dialog")?.close()}
                >
                  {COPY.cancel}
                </Button>
                <Button type="submit" loading={saving.isLoading}>
                  {COPY.save}
                </Button>
              </div>
            )}
          </form>
        </Dialog>
      )}
    >
      <p>{COPY.removeBody}</p>
      {removing.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {COPY.removeFailed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {COPY.keep}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={removing.isLoading}
          onClick={() => void confirmRemove()}
        >
          {COPY.remove}
        </Button>
      </form>
    </Dialog>
  );
}
