"use client";

import { cx } from "@forwend/ui-web";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { profileLabel } from "@/features/profiles/lib/profile";
import { settingsSections } from "@/screens/settings/lib/settings-sections";

const ROW =
  "flex min-h-9 items-center gap-3 rounded-md px-3 text-sm text-muted outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-ink pointer-coarse:min-h-11";

/** Settings share one frame: the sections in a column beside the page on wide screens, a row of tabs on phones. */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const { profile } = useAppSession();
  const pathname = usePathname();
  const groups = settingsSections(profile);
  const label = (group: (typeof groups)[number]) =>
    group.business ? profileLabel(profile) : group.label;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="Settings" className="lg:sticky lg:top-24 lg:self-start">
        {/* Phones: one scrolling row of text tabs; the current one keeps an underline. */}
        <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] lg:hidden">
          {groups
            .flatMap((group) => group.items)
            .map((item) => (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className="-mb-px flex min-h-11 items-center border-b-2 border-transparent px-2 text-sm whitespace-nowrap text-muted outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus aria-[current=page]:border-ink aria-[current=page]:font-medium aria-[current=page]:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
        </ul>
        <div className="hidden flex-col gap-5 lg:flex">
          {groups.map((group) => (
            <div key={group.label}>
              <h2 className="truncate px-3 pb-2 text-xs font-medium text-subtle">{label(group)}</h2>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={pathname === item.href ? "page" : undefined}
                      className={cx(ROW)}
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
      <div className="min-w-0 max-w-3xl">{children}</div>
    </div>
  );
}
