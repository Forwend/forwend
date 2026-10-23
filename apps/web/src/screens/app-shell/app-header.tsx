"use client";

import { Button, IconButton, Skeleton, Tooltip } from "@forwend/ui-web";
import { skipToken } from "@reduxjs/toolkit/query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { AccountInitial, AccountMenu } from "@/features/auth/components/account-menu";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { useGetProfileInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { profileLabel } from "@/features/profiles/lib/profile";
import type { Profile } from "@/features/profiles/types/profile";
import { NotificationsMenu } from "@/features/transactions/components/notifications-menu";
import { breadcrumb } from "@/screens/app-shell/lib/app-nav";
import type { Crumb } from "@/screens/app-shell/types/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

// The two search triggers look like the list search fields they lead to: a soft filled pill.
const SEARCH_TRIGGER =
  "relative h-10 items-center gap-2 rounded-pill bg-surface-2 px-3.5 text-sm text-muted outline-none pointer-coarse:h-11 transition-colors duration-[var(--fw-duration-fast)] hover:text-ink active:bg-[color-mix(in_oklab,var(--fw-ink)_6%,var(--fw-surface-2))] focus-visible:outline-2 focus-visible:outline-focus";

const CRUMB =
  "block truncate rounded-sm text-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:font-medium aria-[current=page]:text-ink";

export const HEADER_COPY = {
  breadcrumb: "Breadcrumb",
  search: "Search",
  searchShortcut: "⌘K",
  collapse: "Collapse sidebar",
  expand: "Expand sidebar",
} as const;

export interface AppHeaderProps {
  active: Profile;
  pathname: string;
  email: string;
  onSignOut: () => void;
  onSearch: () => void;
  onReceive: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function AppHeader({
  active,
  pathname,
  email,
  onSignOut,
  onSearch,
  onReceive,
  collapsed,
  onToggleCollapsed,
}: AppHeaderProps) {
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <header className="sticky top-0 z-[var(--fw-z-nav)] flex min-h-16 items-center gap-3 border-b border-line bg-surface fw-safe-x pt-[env(safe-area-inset-top)]">
      <div className="lg:hidden">
        <AccountMenu
          email={email}
          onSignOut={onSignOut}
          side="bottom"
          trigger={
            <IconButton label={`${AUTH_COPY.account}: ${email}`} size="md">
              <AccountInitial email={email} />
            </IconButton>
          }
        />
      </div>
      <button
        type="button"
        onClick={onSearch}
        className={`${SEARCH_TRIGGER} flex min-w-0 flex-1 lg:hidden`}
      >
        <Search aria-hidden className="size-[var(--fw-icon-sm)]" />
        {HEADER_COPY.search}
      </button>

      <div className="-ml-2 hidden lg:block">
        <IconButton
          label={collapsed ? HEADER_COPY.expand : HEADER_COPY.collapse}
          aria-expanded={!collapsed}
          size="md"
          onClick={onToggleCollapsed}
        >
          <CollapseIcon aria-hidden className="size-[var(--fw-icon-md)]" />
        </IconButton>
      </div>
      <Breadcrumb active={active} pathname={pathname} />
      <button type="button" onClick={onSearch} className={`${SEARCH_TRIGGER} hidden w-56 lg:flex`}>
        <Search aria-hidden className="size-[var(--fw-icon-sm)]" />
        <span className="flex-1 text-left">{HEADER_COPY.search}</span>
        <kbd className="rounded-sm border border-line bg-surface px-1.5 font-mono text-2xs text-muted">
          {HEADER_COPY.searchShortcut}
        </kbd>
      </button>

      <NotificationsMenu profileId={active.profileId} />

      <div className="hidden items-center gap-2 border-l border-line pl-3 lg:flex">
        <Tooltip content={BALANCES_COPY.comingSoon} side="bottom">
          <Button variant="soon" aria-disabled>
            <ArrowUpRight aria-hidden className="size-[var(--fw-icon-sm)]" />
            {BALANCES_COPY.send}
            <span className="sr-only">: {BALANCES_COPY.sendSoon}</span>
          </Button>
        </Tooltip>
        <Button onClick={onReceive}>
          <ArrowDownLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
          {BALANCES_COPY.receive}
        </Button>
      </div>
    </header>
  );
}

function Breadcrumb({ active, pathname }: { active: Profile; pathname: string }) {
  const { trail, invoiceId } = breadcrumb(pathname, active.kind);
  // The invoice page reads the same invoice, so this comes from the cache.
  const invoice = useGetProfileInvoiceQuery(
    invoiceId ? { profileId: active.profileId, invoiceId } : skipToken,
  );
  // null: the invoice is still loading. One that fails to load leaves the trail at Invoices.
  const number: Crumb | null = invoice.data
    ? { label: invoiceNumber(invoice.data.number), href: pathname }
    : null;
  const crumbs = [
    { label: profileLabel(active), href: APP_ROUTES.home },
    ...trail,
    ...(invoiceId && !invoice.isError ? [number] : []),
  ];
  return (
    <nav aria-label={HEADER_COPY.breadcrumb} className="hidden min-w-0 flex-1 lg:block">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb?.label ?? "loading"}>
            {i > 0 ? (
              <li aria-hidden>
                <ChevronRight className="size-[var(--fw-icon-sm)] text-subtle" />
              </li>
            ) : null}
            <li className="min-w-0">
              {crumb ? (
                <Link
                  href={crumb.href}
                  aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  className={CRUMB}
                >
                  {crumb.label}
                </Link>
              ) : (
                <Skeleton className="h-4 w-16" />
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
