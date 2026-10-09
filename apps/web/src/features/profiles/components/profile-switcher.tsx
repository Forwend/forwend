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
  shortAddress,
} from "@forwend/ui-web";
import { ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import { type Profile, profileLabel } from "@/features/profiles/profile";
import { PROFILES_COPY } from "@/features/profiles/profiles-copy";
import { APP_ROUTES } from "@/shared/config/routes";

// The workspace switcher: the chosen profile frames everything below it, and switching keeps you on the same page.
export function ProfileSwitcher({
  profiles,
  active,
  onSwitch,
}: {
  profiles: Profile[];
  active: Profile;
  onSwitch: (profileId: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${PROFILES_COPY.switchProfile}: ${profileLabel(active)}`}
        className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-surface-2"
      >
        <ProfileAvatar kind={active.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {profileLabel(active)}
          </span>
          <span className="block truncate font-mono text-xs text-muted">
            {active.walletAddress
              ? shortAddress(active.walletAddress)
              : PROFILES_COPY.walletNotReady}
          </span>
        </span>
        <ChevronsUpDown aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
      </MenuTrigger>
      <MenuContent className="w-72">
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
