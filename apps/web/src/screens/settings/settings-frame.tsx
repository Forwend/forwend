"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { settingsGroups } from "@/screens/app-shell/lib/app-nav";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { BackLink } from "@/shared/components/detail-header";
import { APP_ROUTES } from "@/shared/config/routes";

const ROW =
  "flex min-h-9 items-center gap-3 rounded-md px-3 text-sm text-muted outline-none hover:transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-ink pointer-coarse:min-h-11";

/** Large screens list the sections beside the page; phones open Settings as a list instead. */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const { profile } = useAppSession();
  const pathname = usePathname();
  const groups = settingsGroups(profile);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="Settings" className="max-lg:hidden lg:sticky lg:top-24 lg:self-start">
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.label}>
              <h2 className="truncate px-3 pb-2 text-xs font-medium text-subtle">{group.label}</h2>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={pathname === item.href ? "page" : undefined}
                      className={ROW}
                    >
                      <item.icon aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <div className="flex min-w-0 max-w-3xl flex-col gap-2">
        {pathname === APP_ROUTES.settings ? null : (
          <BackLink href={APP_ROUTES.settings} label={SETTINGS_COPY.title} />
        )}
        {children}
      </div>
    </div>
  );
}
