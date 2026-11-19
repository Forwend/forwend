"use client";

import { useState } from "react";
import { useCompleteOnboardingMutation } from "@/features/onboarding/api/onboarding-api";
import { ONBOARDING_CHOICES } from "@/features/onboarding/constants/onboarding";
import {
  billingBody,
  landingProfile,
  newKinds,
  websiteOrigin,
} from "@/features/onboarding/lib/onboarding";
import type { OnboardingChoice, ProfileDetails } from "@/features/onboarding/types/onboarding";
import {
  useSaveBillingDetailsMutation,
  useSaveProfileTokensMutation,
} from "@/features/profiles/api/profiles-api";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import type { NewProfileKind, Profile } from "@/features/profiles/types/profile";
import type { TokenRef } from "@/features/profiles/types/tokens";
import { useLazyListStoresQuery, useSaveStoreMutation } from "@/features/stores/api/stores-api";

interface FirstRunAnswers {
  picked: readonly OnboardingChoice[];
  details: Readonly<Record<NewProfileKind, ProfileDetails>>;
  /** Details steps left with Skip: the profile is still made, unnamed, and its billing details wait. */
  skipped: ReadonlySet<NewProfileKind>;
  website: string;
  /** The tokens the profiles turn off; null keeps each profile's own. */
  tokensOff: TokenRef[] | null;
}

/** Makes the named profiles in one call, then saves each one's billing details, tokens and website through their own
 * APIs. Every save is a PUT and a failed one keeps the profiles made, so a retry finishes the rest and makes none twice.
 * profiles is the list before the first run. */
export function useFirstRunSave(profiles: readonly Profile[], personal: Profile | undefined) {
  const [complete] = useCompleteOnboardingMutation();
  const [saveBilling] = useSaveBillingDetailsMutation();
  const [saveTokens] = useSaveProfileTokensMutation();
  const [listStores] = useLazyListStoresQuery();
  const [saveStore] = useSaveStoreMutation();
  const [made, setMade] = useState<readonly Profile[] | null>(null);
  const [after, setAfter] = useState<readonly Profile[]>(profiles);

  const save = async ({ picked, details, skipped, website, tokensOff }: FirstRunAnswers) => {
    let created = made;
    if (!created) {
      const names = Object.fromEntries(
        newKinds(picked)
          .filter((kind) => !skipped.has(kind))
          .map((kind) => [kind, details[kind].name.trim()]),
      );
      const me = await complete({ choices: [...picked], names }).unwrap();
      created = me.profiles.filter((p) => !profiles.some((b) => b.profileId === p.profileId));
      setMade(created);
      setAfter(me.profiles);
    }
    for (const profile of created) {
      if (profile.kind !== PROFILE_KINDS.freelancer && profile.kind !== PROFILE_KINDS.merchant)
        continue;
      if (skipped.has(profile.kind)) continue;
      await saveBilling({
        profileId: profile.profileId,
        body: billingBody(details[profile.kind]),
      }).unwrap();
    }
    if (tokensOff) {
      const targets = [
        ...created,
        ...(picked.includes(ONBOARDING_CHOICES.receiveAndSend) && personal ? [personal] : []),
      ];
      for (const profile of targets)
        await saveTokens({ profileId: profile.profileId, off: tokensOff }).unwrap();
    }
    const merchant = created.find((p) => p.kind === PROFILE_KINDS.merchant);
    const origin = websiteOrigin(website);
    if (merchant && origin && !skipped.has(PROFILE_KINDS.merchant)) {
      const [store] = await listStores(merchant.profileId).unwrap();
      if (store && !store.allowedOrigins.includes(origin)) {
        await saveStore({
          profileId: merchant.profileId,
          storeId: store.storeId,
          body: {
            name: store.name,
            defaultExpiresIn: store.defaultExpiresIn,
            allowedOrigins: [...store.allowedOrigins, origin],
            brandColor: store.brandColor ?? "",
            tokensOff: store.tokensOff,
          },
        }).unwrap();
      }
    }
  };

  /** Skip setup: no profiles are made. Answers the profile to open. */
  const skip = async () => {
    const me = await complete({ choices: [], names: {} }).unwrap();
    return landingProfile(profiles, me.profiles);
  };

  return { made, after, save, skip };
}
