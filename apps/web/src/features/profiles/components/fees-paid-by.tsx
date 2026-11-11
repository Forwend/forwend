"use client";

import { ChoiceCard, TONES, useToast } from "@forwend/ui-web";
import { UserRound, Wallet } from "lucide-react";
import { useSaveProfileFeesMutation } from "@/features/profiles/api/profiles-api";
import { FEES_PAID_BY, PERMISSIONS } from "@/features/profiles/constants/profile";
import { FEES_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { can } from "@/features/profiles/lib/profile";
import type { FeesPaidBy, Profile } from "@/features/profiles/types/profile";
import { SettingsGroup } from "@/shared/components/settings-group";

/** D-122, R-227: who pays the profile's new invoices' fees unless an invoice or link says otherwise. */
export function FeesPaidBySetting({ profile }: { profile: Profile }) {
  const [save, { isLoading, isError }] = useSaveProfileFeesMutation();
  const toast = useToast();
  const current = profile.feesPaidBy ?? FEES_PAID_BY.owner;
  const allowed = can(profile, PERMISSIONS.billingWrite);
  const choose = async (feesPaidBy: FeesPaidBy) => {
    try {
      await save({ profileId: profile.profileId, feesPaidBy }).unwrap();
      toast({ tone: TONES.success, title: COPY.saved });
    } catch {
      // Said below; the choice stays as saved.
    }
  };
  return (
    <SettingsGroup title={COPY.title} note={allowed ? COPY.kept : COPY.ownersOnly}>
      <div className="flex flex-col gap-3">
        <fieldset disabled={isLoading || !allowed} className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">{COPY.legend}</legend>
          <ChoiceCard
            type="radio"
            name="fees-paid-by"
            value={FEES_PAID_BY.owner}
            checked={current === FEES_PAID_BY.owner}
            onChange={() => void choose(FEES_PAID_BY.owner)}
            icon={Wallet}
            title={COPY.owner}
            hint={COPY.ownerHint}
          />
          <ChoiceCard
            type="radio"
            name="fees-paid-by"
            value={FEES_PAID_BY.client}
            checked={current === FEES_PAID_BY.client}
            onChange={() => void choose(FEES_PAID_BY.client)}
            icon={UserRound}
            title={COPY.client}
            hint={COPY.clientHint}
          />
        </fieldset>
        {isError ? (
          <p role="alert" className="text-sm text-danger">
            {COPY.saveFailed}
          </p>
        ) : null}
      </div>
    </SettingsGroup>
  );
}
