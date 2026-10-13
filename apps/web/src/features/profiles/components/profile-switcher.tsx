"use client";

import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@forwend/ui-web";
import { ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import { PROFILE_KIND_LABELS } from "@/features/profiles/constants/profile";
import { PROFILES_COPY } from "@/features/profiles/constants/profiles-copy";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { APP_ROUTES } from "@/shared/config/routes";

// The workspace switcher: the chosen profile frames everything below it, and switching keeps you on the same page.
export function ProfileSwitcher({
  profiles,
  active,
  onSwitch,
  compact = false,
}: {
  profiles: Profile[];
  active: Profile;
  onSwitch: (profileId: string) => void;
  compact?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${PROFILES_COPY.switchProfile}: ${profileLabel(active)}`}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-md p-1.5 text-left outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-surface-2"
      >
        <ProfileAvatar kind={active.kind} />
        <span className={compact ? "sr-only" : "min-w-0 flex-1"}>
          <span className="block truncate text-sm font-semibold text-ink">
            {active.name ?? PROFILE_KIND_LABELS[active.kind]}
          </span>
          {active.name ? (
            <span className="block truncate text-xs text-muted">
              {PROFILE_KIND_LABELS[active.kind]}
            </span>
          ) : null}
        </span>
        {compact ? null : (
          <ChevronsUpDown aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
        )}
      </MenuTrigger>
      <MenuContent side={compact ? "right" : "bottom"} className="w-72">
        <MenuLabel>{PROFILES_COPY.profiles}</MenuLabel>
        <MenuRadioGroup value={active.profileId} onValueChange={onSwitch}>
          {profiles.map((p) => (
            <MenuRadioItem key={p.profileId} value={p.profileId}>
              <span className="flex items-center gap-3">
                <ProfileAvatar kind={p.kind} />
                <span className="truncate">{profileLabel(p)}</span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href={APP_ROUTES.newProfile}>
            <span className="grid size-9 place-items-center rounded-md border border-dashed border-line-strong text-muted">
              <Plus aria-hidden className="size-[var(--fw-icon-md)]" />
            </span>
            {PROFILES_COPY.newProfile}
          </Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
