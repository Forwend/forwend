"use client";

import { Checkbox, SelectField } from "@forwend/ui-web";
import { ROLE_LABELS, ROLES } from "@/features/profiles/constants/profile";
import type { Store } from "@/features/stores/types/stores";
import { MEMBER_ROLES } from "@/features/team/constants/team";
import { TEAM_COPY as COPY } from "@/features/team/constants/team-copy";
import type { MemberRole } from "@/features/team/types/team";

export interface GrantFieldsProps {
  role: MemberRole;
  onRole: (role: MemberRole) => void;
  stores: readonly Store[];
  chosen: readonly string[];
  onChosen: (storeIds: string[]) => void;
  storesError?: string;
  /** While the user confirms it's them, the role stays as it was sent. */
  disabled?: boolean;
}

// D-93: an Admin reaches every store; a Developer or Finance member only the ones chosen here.
export function GrantFields({
  role,
  onRole,
  stores,
  chosen,
  onChosen,
  storesError,
  disabled,
}: GrantFieldsProps) {
  return (
    <>
      <SelectField
        disabled={disabled}
        label={COPY.role}
        options={MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        value={role}
        onValueChange={(value) => onRole(MEMBER_ROLES.find((r) => r === value) ?? ROLES.admin)}
        hint={COPY.roleHints[role]}
      />
      {role === ROLES.admin ? null : (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-ink">{COPY.stores}</legend>
          <p className="text-sm text-muted">{COPY.storesHint}</p>
          {stores.map((store) => (
            <Checkbox
              key={store.storeId}
              label={store.name}
              checked={chosen.includes(store.storeId)}
              onChange={(event) =>
                onChosen(
                  event.target.checked
                    ? [...chosen, store.storeId]
                    : chosen.filter((id) => id !== store.storeId),
                )
              }
            />
          ))}
          {storesError ? (
            <p role="alert" className="text-sm text-danger">
              {storesError}
            </p>
          ) : null}
        </fieldset>
      )}
    </>
  );
}
