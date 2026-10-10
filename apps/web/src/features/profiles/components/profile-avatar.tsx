import { FreelancerIcon, MerchantIcon } from "@forwend/ui-web";
import { User } from "lucide-react";
import { PROFILE_KINDS, type ProfileKind } from "@/features/profiles/profile";

const ICONS = {
  [PROFILE_KINDS.personal]: User,
  [PROFILE_KINDS.freelancer]: FreelancerIcon,
  [PROFILE_KINDS.merchant]: MerchantIcon,
} as const;

/** A square tile with the profile type's icon, the profile's mark in the switcher. */
export function ProfileAvatar({ kind }: { kind: ProfileKind }) {
  const Icon = ICONS[kind];
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary text-on-primary">
      <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
    </span>
  );
}
