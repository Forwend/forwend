"use client";

import { Sheet, shortAddress } from "@forwend/ui-web";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import { type Profile, profileLabel } from "@/features/profiles/profile";
import { PROFILES_COPY } from "@/features/profiles/profiles-copy";
import { DESKTOP_QUERY } from "@/shared/config/breakpoints";
import { APP_ROUTES } from "@/shared/config/routes";

// The phone switcher: the same choice as the sidebar's menu, in a bottom sheet a thumb can reach.
export function ProfileSheet({
  profiles,
  active,
  onSwitch,
}: {
  profiles: Profile[];
  active: Profile;
  onSwitch: (profileId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // The sheet lives in the phone header, which the desktop layout hides: close it when the window turns desktop-wide
  // (a tablet rotated), or it would stay open, unseen, over the page.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => desktop.matches && setOpen(false);
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${PROFILES_COPY.switchProfile}: ${profileLabel(active)}`}
        onClick={() => setOpen(true)}
        className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
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
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={PROFILES_COPY.profiles}>
        <ul className="flex flex-col gap-1">
          {profiles.map((p) => {
            const current = p.profileId === active.profileId;
            return (
              <li key={p.profileId}>
                <button
                  type="button"
                  aria-pressed={current}
                  onClick={() => {
                    onSwitch(p.profileId);
                    setOpen(false);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus aria-pressed:bg-surface-2"
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
            onClick={() => setOpen(false)}
            className="flex min-h-14 items-center gap-3 rounded-lg px-2 text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="grid size-9 place-items-center rounded-md border border-dashed border-line-strong text-muted">
              <Plus aria-hidden className="size-[var(--fw-icon-md)]" />
            </span>
            {PROFILES_COPY.newProfile}
          </Link>
        </div>
      </Sheet>
    </>
  );
}
