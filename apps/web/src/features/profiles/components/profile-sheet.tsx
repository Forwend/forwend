"use client";

import { Sheet } from "@forwend/ui-web";
import { Check, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import { PROFILES_COPY } from "@/features/profiles/constants/profiles-copy";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { DESKTOP_QUERY } from "@/shared/config/breakpoints";
import { APP_ROUTES } from "@/shared/config/routes";

// The phone switcher: the same choice as the sidebar's menu, in a bottom sheet a thumb can reach. Opened from the tab
// bar or the profile pill over the balance.
export function ProfileSheet({
  profiles,
  active,
  onSwitch,
  open,
  onOpenChange,
}: {
  profiles: Profile[];
  active: Profile;
  onSwitch: (profileId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // The sheet belongs to the phone layout: close it when the window turns desktop-wide (a tablet rotated), or it
  // would stay open over the desktop page.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => desktop.matches && onOpenChange(false);
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [onOpenChange]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={PROFILES_COPY.profiles}>
      <ul className="flex flex-col gap-1">
        {profiles.map((p) => {
          const current = p.profileId === active.profileId;
          return (
            <li key={p.profileId}>
              <button
                type="button"
                aria-current={current || undefined}
                onClick={() => {
                  onSwitch(p.profileId);
                  onOpenChange(false);
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus aria-[current]:bg-surface-2"
              >
                <ProfileAvatar kind={p.kind} />
                <span className="min-w-0 flex-1 truncate">{profileLabel(p)}</span>
                {current ? <Check aria-hidden className="size-[var(--fw-icon-md)]" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 border-t border-line pt-2">
        <Link
          href={APP_ROUTES.newProfile}
          onClick={() => onOpenChange(false)}
          className="flex min-h-14 items-center gap-3 rounded-md px-2 text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span className="grid size-9 place-items-center rounded-md border border-dashed border-line-strong text-muted">
            <Plus aria-hidden className="size-[var(--fw-icon-md)]" />
          </span>
          {PROFILES_COPY.newProfile}
        </Link>
      </div>
    </Sheet>
  );
}
