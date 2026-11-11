"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { profileLabel } from "@/features/profiles/lib/profile";
import { SETTINGS_COPY as COPY } from "@/screens/settings/constants/settings-copy";
import { settingsSections } from "@/screens/settings/lib/settings-sections";
import { SETTINGS_TITLE, SettingsGroup } from "@/shared/components/settings-group";
import { DESKTOP_QUERY } from "@/shared/config/breakpoints";

const ROW =
  "flex min-h-14 items-center gap-3 px-3 text-base text-ink outline-none hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/** Phones: Settings is a list of its pages, as a phone's settings app opens. From large screens the frame's column
 * already lists them, so Settings opens the first page. */
export function SettingsIndex() {
  const { profile } = useAppSession();
  const router = useRouter();
  const groups = settingsSections(profile);
  const first = groups[0]?.items[0]?.href;
  // Also when a tablet turns wide, where the list is hidden.
  useEffect(() => {
    if (!first) return;
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const open = () => desktop.matches && router.replace(first);
    open();
    desktop.addEventListener("change", open);
    return () => desktop.removeEventListener("change", open);
  }, [first, router]);
  return (
    <div className="flex flex-col gap-6 lg:hidden">
      <h1 className={SETTINGS_TITLE}>{COPY.title}</h1>
      <nav aria-label={COPY.title} className="flex flex-col gap-6">
        {groups.map((group) => (
          <SettingsGroup
            key={group.label}
            title={group.business ? profileLabel(profile) : group.label}
          >
            <ul className="fw-panel divide-y divide-line overflow-hidden">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={ROW}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
                      <item.icon aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">{item.label}</span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </SettingsGroup>
        ))}
      </nav>
    </div>
  );
}
