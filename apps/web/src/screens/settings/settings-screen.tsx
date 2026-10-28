"use client";

import { ROW_INTERACTIVE_CLASSES } from "@forwend/ui-web";
import { Bell, ChevronRight, Coins, Landmark, Users } from "lucide-react";
import Link from "next/link";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { accountLinks, pageAllowed } from "@/screens/app-shell/lib/app-nav";
import { SETTINGS_COPY as COPY } from "@/screens/settings/constants/settings-copy";
import { APP_ROUTES } from "@/shared/config/routes";

/** One place for the settings that exist today; each opens its own page. New settings join as their features ship. */
export function SettingsScreen() {
  const { profile } = useAppSession();
  const links = accountLinks(profile);
  const rows = [
    profile.kind !== PROFILE_KINDS.personal && pageAllowed(profile, APP_ROUTES.billingDetails)
      ? { href: APP_ROUTES.billingDetails, icon: Landmark, ...COPY.billing }
      : null,
    pageAllowed(profile, APP_ROUTES.networks)
      ? { href: APP_ROUTES.networks, icon: Coins, ...COPY.networks }
      : null,
    links.notifications
      ? { href: APP_ROUTES.notifications, icon: Bell, ...COPY.notifications }
      : null,
    links.team ? { href: APP_ROUTES.team, icon: Users, ...COPY.team } : null,
  ].filter((row) => row !== null);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
      <ul className="fw-panel divide-y divide-line overflow-hidden">
        {rows.map((row) => (
          <li key={row.href}>
            <Link
              href={row.href}
              className={`flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 text-muted">
                <row.icon aria-hidden className="size-[var(--fw-icon-sm)]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{row.title}</span>
                <span className="block text-sm text-muted">{row.text}</span>
              </span>
              <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
