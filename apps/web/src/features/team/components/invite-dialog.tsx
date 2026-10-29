"use client";

import { BUTTON_VARIANTS, Button, Dialog, TextField, TONES, useToast } from "@forwend/ui-web";
import { Plus } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { ROLES } from "@/features/profiles/constants/profile";
import type { Store } from "@/features/stores/types/stores";
import { useInviteMutation } from "@/features/team/api/team-api";
import { GrantFields } from "@/features/team/components/grant-fields";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import { grantError } from "@/features/team/lib/team";
import type { MemberRole } from "@/features/team/types/team";

export interface InviteDialogProps {
  profileId: string;
  stores: readonly Store[];
}

// R-139: the API asks for a fresh sign-in first when the last one is older than 5 minutes (D-63).
export function InviteDialog({ profileId, stores }: InviteDialogProps) {
  const [invite, { isLoading }] = useInviteMutation();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  // The role with the least reach comes first, so giving more is a choice.
  const [role, setRole] = useState<MemberRole>(ROLES.developer);
  const [chosen, setChosen] = useState<string[]>([]);
  const [errors, setErrors] = useState<ReturnType<typeof grantError>>({});
  const reset = () => {
    setEmail("");
    setRole(ROLES.developer);
    setChosen([]);
    setErrors({});
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (role !== ROLES.admin && chosen.length === 0)
      return setErrors({ stores: COPY.errors.stores });
    setErrors({});
    try {
      const made = await invite({
        profileId,
        body: { email, role, stores: role === ROLES.admin ? [] : chosen },
      }).unwrap();
      toast({ tone: TONES.success, title: COPY.sent(made.email) });
      form.current?.closest("dialog")?.close();
    } catch (failure) {
      setErrors(grantError(failure));
    }
  };
  return (
    <Dialog
      triggerLabel={COPY.invite}
      title={COPY.inviteTitle}
      onClose={reset}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.invite}
        </Button>
      )}
    >
      <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">{COPY.inviteIntro}</p>
        <TextField
          label={COPY.email}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <GrantFields
          role={role}
          onRole={setRole}
          stores={stores}
          chosen={chosen}
          onChosen={setChosen}
          storesError={errors.stores}
        />
        {errors.form ? (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant={BUTTON_VARIANTS.secondary}
            onClick={() => form.current?.closest("dialog")?.close()}
          >
            {COPY.cancel}
          </Button>
          <Button type="submit" loading={isLoading}>
            {COPY.send}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
