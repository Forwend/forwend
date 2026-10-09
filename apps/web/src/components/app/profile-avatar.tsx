import { FreelancerIcon, MerchantIcon } from "@forwend/ui-web";
import { User } from "lucide-react";
import { PROFILE_KINDS } from "@/constants/app";
import type { ProfileKind } from "@/types/app/profile";

const ICONS = {
  [PROFILE_KINDS.personal]: User,
  [PROFILE_KINDS.freelancer]: FreelancerIcon,
  [PROFILE_KINDS.merchant]: MerchantIcon,
} as const;

/** A square tile with the profile type's icon, the profile's mark in the switcher. */
export function ProfileAvatar({ kind }: { kind: ProfileKind }) {
  const Icon = ICONS[kind];
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-ink">
      <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
    </span>
  );
}
