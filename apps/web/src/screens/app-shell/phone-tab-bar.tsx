"use client";

import { Sheet } from "@forwend/ui-web";
import { ChevronRight, ChevronsUpDown, Home, Menu, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { BILLING_DETAILS_COPY, PROFILES_COPY } from "@/features/profiles/constants/profiles-copy";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { APP_NAV, NAV } from "@/screens/app-shell/constants/app-nav";
import { isCurrentPage } from "@/screens/app-shell/lib/app-nav";
import { DESKTOP_QUERY } from "@/shared/config/breakpoints";
import { APP_ROUTES } from "@/shared/config/routes";

const TAB_COPY = { home: "Home", nav: "Main", more: "More", soon: "Coming soon" } as const;
const TABS = [
  { ...NAV.overview, label: TAB_COPY.home, icon: Home },
  NAV.transactions,
  NAV.balances,
] as const;
const TAB =
  "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-medium text-muted outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus data-[active=true]:bg-surface-2 data-[active=true]:text-ink";
const CARD = "overflow-hidden rounded-md border border-line bg-surface divide-y divide-line";
const ROW =
  "group flex min-h-14 w-full items-center gap-3 px-3 text-left text-sm font-medium text-ink outline-none hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";
const ROW_ICON =
  "grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted group-aria-[current=page]:bg-info-soft group-aria-[current=page]:text-info";
const HEADING = "px-1 pb-2 text-xs font-medium text-muted";

export interface PhoneTabBarProps {
  pathname: string;
  active: Profile;
  onProfiles: () => void;
}

export function PhoneTabBar({ pathname, active, onProfiles }: PhoneTabBarProps) {
  const [open, setOpen] = useState(false);
  const primary = TABS.some(({ href }) => isCurrentPage(pathname, href));
  const items = APP_NAV[active.kind].map((group) => ({
    ...group,
    items: group.items.filter((item) => !TABS.some((tab) => tab.href === item.href)),
  }));
  const groups = items
    .map((group) => ({ ...group, items: group.items.filter((item) => item.href) }))
    .filter((group) => group.items.length > 0);
  const soon = items.flatMap((group) => group.items.filter((item) => !item.href));
  const pageLink = (href: string) => ({
    href,
    onClick: () => setOpen(false),
    "aria-current": isCurrentPage(pathname, href) ? ("page" as const) : undefined,
    className: ROW,
  });

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
        className="fixed inset-x-0 bottom-0 z-[var(--fw-z-nav)] border-t border-line bg-surface pl-[max(.5rem,env(safe-area-inset-left))] pr-[max(.5rem,env(safe-area-inset-right))] pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom,0px))] lg:hidden"
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
        <div className="flex flex-col gap-6">
          <div className={CARD}>
            <button
              type="button"
              aria-label={`${PROFILES_COPY.switchProfile}: ${profileLabel(active)}`}
              aria-haspopup="dialog"
              onClick={() => {
                setOpen(false);
                onProfiles();
              }}
              className={`${ROW} min-h-16`}
            >
              <ProfileAvatar kind={active.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base">{profileLabel(active)}</span>
                <span className="block text-sm font-normal text-muted">
                  {PROFILES_COPY.switchProfile}
                </span>
              </span>
              <ChevronsUpDown aria-hidden className="size-5 shrink-0 text-muted" />
            </button>
            {active.kind !== PROFILE_KINDS.personal ? (
              <Link {...pageLink(APP_ROUTES.billingDetails)}>
                <span className={ROW_ICON}>
                  <ReceiptText aria-hidden className="size-5" />
                </span>
                {BILLING_DETAILS_COPY.title}
                <ChevronRight aria-hidden className="ml-auto size-4 text-muted" />
              </Link>
            ) : null}
          </div>
          <nav aria-label={TAB_COPY.more} className="flex flex-col gap-6">
            {groups.map((group) => (
              <div key={group.label}>
                <h3 className={HEADING}>{group.label}</h3>
                <ul className={CARD}>
                  {group.items.map(({ href, label, icon: Icon }) =>
                    href ? (
                      <li key={label}>
                        <Link {...pageLink(href)}>
                          <span className={ROW_ICON}>
                            <Icon aria-hidden className="size-5" />
                          </span>
                          {label}
                          <ChevronRight aria-hidden className="ml-auto size-4 text-muted" />
                        </Link>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ))}
          </nav>
          {soon.length > 0 ? (
            <div>
              <h3 className={HEADING}>{TAB_COPY.soon}</h3>
              <ul className="flex flex-wrap gap-2">
                {soon.map(({ label, icon: Icon }) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-line px-3 py-1.5 text-xs text-muted"
                  >
                    <Icon aria-hidden className="size-4" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
