import { FreelancerIcon, MerchantIcon } from "@forwend/ui-web";
import { User } from "lucide-react";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import type { ProfileKind } from "@/features/profiles/types/profile";

const ICONS = {
  [PROFILE_KINDS.personal]: User,
  [PROFILE_KINDS.freelancer]: FreelancerIcon,
  [PROFILE_KINDS.merchant]: MerchantIcon,
} as const;

export interface ProfileAvatarProps {
  kind: ProfileKind;
}

/** A square tile with the profile type's icon, the profile's mark in the switcher. */
export function ProfileAvatar({ kind }: ProfileAvatarProps) {
  const Icon = ICONS[kind];
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary text-on-primary">
      <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
    </span>
  );
}
