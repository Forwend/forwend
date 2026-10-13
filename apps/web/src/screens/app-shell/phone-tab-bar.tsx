"use client";

import { Home, type LucideIcon, Users } from "lucide-react";
import Link from "next/link";
import { PROFILES_COPY } from "@/features/profiles/constants/profiles-copy";
import { NAV } from "@/screens/app-shell/constants/app-nav";

const TAB_COPY = { home: "Home", nav: "Main" } as const;

const TAB =
  "group flex h-16 flex-col items-center justify-center gap-1 text-xs text-muted outline-none focus-visible:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink";
const TAB_ICON =
  "grid h-7 w-12 place-items-center rounded-pill transition-colors duration-[var(--fw-duration-fast)] group-aria-[current=page]:bg-surface-2";

export interface PhoneTabBarProps {
  pathname: string;
  onProfiles: () => void;
}

export function PhoneTabBar({ pathname, onProfiles }: PhoneTabBarProps) {
  const tabs = [
    { ...NAV.overview, label: TAB_COPY.home, icon: Home },
    NAV.transactions,
    NAV.balances,
  ] as const;
  return (
    <nav
      aria-label={TAB_COPY.nav}
      className="fixed inset-x-0 bottom-0 z-[var(--fw-z-nav)] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {tabs.map(({ href, label, icon }) => (
          <li key={href} className="grid">
            <Link href={href} aria-current={pathname === href ? "page" : undefined} className={TAB}>
              <TabIcon icon={icon} />
              {label}
            </Link>
          </li>
        ))}
        <li className="grid">
          <button type="button" aria-haspopup="dialog" onClick={onProfiles} className={TAB}>
            <TabIcon icon={Users} />
            {PROFILES_COPY.profiles}
          </button>
        </li>
      </ul>
    </nav>
  );
}

function TabIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className={TAB_ICON}>
      <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
    </span>
  );
}
