"use client";

import { RowButton, Sheet } from "@forwend/ui-web";
import { ChevronRight, Home, Menu, ReceiptText, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { BILLING_DETAILS_COPY, PROFILES_COPY } from "@/features/profiles/constants/profiles-copy";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { APP_NAV, NAV } from "@/screens/app-shell/constants/app-nav";
import { isCurrentPage } from "@/screens/app-shell/lib/app-nav";
import { DESKTOP_QUERY } from "@/shared/config/breakpoints";
import { APP_ROUTES } from "@/shared/config/routes";

const TAB_COPY = { home: "Home", nav: "Main", more: "More" } as const;
const TABS = [
  { ...NAV.overview, label: TAB_COPY.home, icon: Home },
  NAV.transactions,
  NAV.balances,
] as const;
const TAB =
  "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-medium text-muted outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus data-[active=true]:bg-surface-2 data-[active=true]:text-ink";
const PAGE_LINK =
  "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm text-ink outline-none hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium";

export interface PhoneTabBarProps {
  pathname: string;
  active: Profile;
  onProfiles: () => void;
}

export function PhoneTabBar({ pathname, active, onProfiles }: PhoneTabBarProps) {
  const [open, setOpen] = useState(false);
  const primary = TABS.some(({ href }) => isCurrentPage(pathname, href));
  const groups = APP_NAV[active.kind]
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !TABS.some((tab) => tab.href === item.href)),
    }))
    .filter((group) => group.items.length > 0);

  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const closeOnDesktop = () => desktop.matches && setOpen(false);
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <>
      <nav
        aria-label={TAB_COPY.nav}
        className="fixed inset-x-0 bottom-0 z-[var(--fw-z-nav)] border-t border-line bg-surface px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom,0px))] lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-4 gap-1">
          {TABS.map(({ href, label, icon: Icon }) => {
            const current = isCurrentPage(pathname, href);
            return (
              <li key={href} className="grid min-w-0">
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  data-active={current}
                  className={TAB}
                >
                  <Icon aria-hidden className="size-6" />
                  {label}
                </Link>
              </li>
            );
          })}
          <li className="grid min-w-0">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-current={!primary ? "true" : undefined}
              data-active={!primary || open}
              onClick={() => setOpen(true)}
              className={TAB}
            >
              <Menu aria-hidden className="size-6" />
              {TAB_COPY.more}
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={open} onOpenChange={setOpen} title={TAB_COPY.more}>
        <nav aria-label={TAB_COPY.more} className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.label}>
              <h3 className="px-3 pb-1 text-xs font-medium text-muted">{group.label}</h3>
              <ul className="flex flex-col gap-1">
                {group.items.map(({ href, label, icon: Icon }) => (
                  <li key={label}>
                    {href ? (
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        aria-current={isCurrentPage(pathname, href) ? "page" : undefined}
                        className={PAGE_LINK}
                      >
                        <Icon aria-hidden className="size-5 shrink-0" />
                        {label}
                        <ChevronRight aria-hidden className="ml-auto size-4 text-muted" />
                      </Link>
                    ) : (
                      <span className="flex min-h-12 items-center gap-3 px-3 text-sm text-subtle">
                        <Icon aria-hidden className="size-5 shrink-0" />
                        {label}
                        <span className="ml-auto text-xs">{AUTH_COPY.soon}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {active.kind !== PROFILE_KINDS.personal ? (
            <Link
              href={APP_ROUTES.billingDetails}
              onClick={() => setOpen(false)}
              aria-current={isCurrentPage(pathname, APP_ROUTES.billingDetails) ? "page" : undefined}
              className={PAGE_LINK}
            >
              <ReceiptText aria-hidden className="size-5 shrink-0" />
              {BILLING_DETAILS_COPY.title}
              <ChevronRight aria-hidden className="ml-auto size-4 text-muted" />
            </Link>
          ) : null}
        </nav>
        <div className="mt-4 border-t border-line pt-2">
          <RowButton
            aria-label={PROFILES_COPY.profiles}
            aria-haspopup="dialog"
            onClick={() => {
              setOpen(false);
              onProfiles();
            }}
          >
            <Users aria-hidden className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{PROFILES_COPY.profiles}</span>
              <span className="block truncate text-xs text-muted">{profileLabel(active)}</span>
            </span>
            <ChevronRight aria-hidden className="size-4 text-muted" />
          </RowButton>
        </div>
      </Sheet>
    </>
  );
}
