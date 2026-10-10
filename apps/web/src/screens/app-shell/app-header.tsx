"use client";

import { buttonClasses, Tooltip } from "@forwend/ui-web";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { AccountInitial, AccountMenu } from "@/features/auth/account-menu";
import { AUTH_COPY } from "@/features/auth/auth-copy";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { type Profile, profileLabel } from "@/features/profiles/profile";
import { NotificationsMenu } from "@/features/transactions/notifications-menu";
import { pageLabel } from "@/screens/app-shell/app-nav";

const SOON_ACTION_CLASSES =
  "inline-flex h-8 cursor-not-allowed items-center gap-2 rounded-pill border border-dashed border-line-strong px-3.5 text-sm font-medium whitespace-nowrap text-subtle outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const HEADER_COPY = {
  breadcrumb: "Breadcrumb",
  search: "Search",
  searchShortcut: "⌘K",
  collapse: "Collapse sidebar",
  expand: "Expand sidebar",
} as const;

export function AppHeader({
  active,
  pathname,
  email,
  onSignOut,
  onSearch,
  onReceive,
  collapsed,
  onToggleCollapsed,
}: {
  active: Profile;
  pathname: string;
  email: string;
  onSignOut: () => void;
  onSearch: () => void;
  onReceive: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <header className="sticky top-0 z-[var(--fw-z-nav)] flex h-14 items-center gap-3 border-b border-line bg-[color-mix(in_oklab,var(--fw-bg)_88%,transparent)] px-4 backdrop-blur-glass sm:px-6">
      <div className="lg:hidden">
        <AccountMenu
          email={email}
          onSignOut={onSignOut}
          side="bottom"
          trigger={
            <button
              type="button"
              aria-label={`${AUTH_COPY.account}: ${email}`}
              className="grid size-10 place-items-center rounded-pill outline-none focus-visible:outline-2 focus-visible:outline-focus"
            >
              <AccountInitial email={email} />
            </button>
          }
        />
      </div>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-pill bg-surface-2 px-3 text-sm text-muted outline-none focus-visible:outline-2 focus-visible:outline-focus lg:hidden"
      >
        <Search aria-hidden className="size-[var(--fw-icon-sm)]" />
        {HEADER_COPY.search}
      </button>

      <button
        type="button"
        aria-label={collapsed ? HEADER_COPY.expand : HEADER_COPY.collapse}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
        className="-ml-2 hidden size-8 place-items-center rounded-sm text-muted outline-none hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus lg:grid"
      >
        <CollapseIcon aria-hidden className="size-[var(--fw-icon-md)]" />
      </button>
      <nav aria-label={HEADER_COPY.breadcrumb} className="hidden min-w-0 flex-1 lg:block">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          <li className="truncate text-muted">{profileLabel(active)}</li>
          <li aria-hidden>
            <ChevronRight className="size-[var(--fw-icon-sm)] text-subtle" />
          </li>
          <li aria-current="page" className="truncate font-medium text-ink">
            {pageLabel(pathname)}
          </li>
        </ol>
      </nav>
      <button
        type="button"
        onClick={onSearch}
        className="hidden h-9 w-64 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm text-subtle outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-focus lg:flex"
      >
        <Search aria-hidden className="size-[var(--fw-icon-sm)]" />
        <span className="flex-1 text-left">{HEADER_COPY.search}</span>
        <kbd className="rounded-sm border border-line bg-surface-2 px-1.5 font-mono text-2xs text-muted">
          {HEADER_COPY.searchShortcut}
        </kbd>
      </button>

      <NotificationsMenu profileId={active.profileId} />

      <div className="hidden items-center gap-2 border-l border-line pl-3 lg:flex">
        <Tooltip content={BALANCES_COPY.comingSoon} side="bottom">
          <button type="button" aria-disabled className={SOON_ACTION_CLASSES}>
            <ArrowUpRight aria-hidden className="size-[var(--fw-icon-sm)]" />
            {BALANCES_COPY.send}
            <span className="sr-only">: {BALANCES_COPY.sendSoon}</span>
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={onReceive}
          className={`${buttonClasses({ size: "sm" })} outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
        >
          <ArrowDownLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
          {BALANCES_COPY.receive}
        </button>
      </div>
    </header>
  );
}
