"use client";

import { IconButton, LogoMark, Tooltip } from "@forwend/ui-web";
import { Settings } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { AccountInitial, AccountMenu } from "@/features/auth/components/account-menu";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { SetupGuide } from "@/features/onboarding/components/setup-guide";
import { ProfileSwitcher } from "@/features/profiles/components/profile-switcher";
import type { Profile } from "@/features/profiles/types/profile";
import {
  isCurrentPage,
  navFor,
  pageAllowed,
  SETTINGS_PATHS,
} from "@/screens/app-shell/lib/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

const SIDEBAR_COPY = {
  home: "Forwend overview",
  nav: "Main",
} as const;

const ROW =
  "flex min-h-9 items-center gap-3 rounded-md text-sm outline-none pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-focus";

export interface AppSidebarProps {
  profiles: Profile[];
  active: Profile;
  onSwitch: (profileId: string) => void;
  pathname: string;
  email: string;
  onSignOut: () => void;
  collapsed: boolean;
}

export function AppSidebar({
  profiles,
  active,
  onSwitch,
  pathname,
  email,
  onSignOut,
  collapsed,
}: AppSidebarProps) {
  const named = (label: string, node: ReactElement) =>
    collapsed ? (
      <Tooltip content={label} side="right">
        {node}
      </Tooltip>
    ) : (
      node
    );

  return (
    <aside
      className={`fixed inset-y-0 left-0 hidden flex-col border-r border-line bg-surface lg:flex ${collapsed ? "w-16" : "w-64"}`}
    >
      <div
        className={`flex h-16 shrink-0 items-center gap-2 border-b border-line ${collapsed ? "justify-center" : "px-3"}`}
      >
        {collapsed ? null : (
          <>
            <Link
              href={APP_ROUTES.home}
              aria-label={SIDEBAR_COPY.home}
              className="grid size-8 shrink-0 place-items-center rounded-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus"
            >
              <LogoMark className="size-6" />
            </Link>
            <span aria-hidden className="text-line-strong">
              /
            </span>
          </>
        )}
        <div className={collapsed ? "" : "min-w-0 flex-1"}>
          <ProfileSwitcher
            profiles={profiles}
            active={active}
            onSwitch={onSwitch}
            compact={collapsed}
          />
        </div>
      </div>

      <nav
        aria-label={SIDEBAR_COPY.nav}
        className={`flex-1 overflow-y-auto overscroll-contain py-6 ${collapsed ? "px-2" : "px-3"}`}
      >
        {navFor(active).map((group) => (
          <div key={group.label} className={collapsed ? "mb-3" : "mb-5"}>
            <h2 className={collapsed ? "sr-only" : "px-3 pb-2 text-xs font-medium text-subtle"}>
              {group.label}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon }) => (
                <li key={label} className={collapsed ? "grid justify-center" : ""}>
                  {href
                    ? named(
                        label,
                        <Link
                          href={href}
                          aria-current={isCurrentPage(pathname, href) ? "page" : undefined}
                          className={`${ROW} text-muted transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 active:bg-[color-mix(in_oklab,var(--fw-ink)_6%,var(--fw-surface-2))] hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-ink ${collapsed ? "w-9 justify-center" : "px-3"}`}
                        >
                          <Icon aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
                          <span className={collapsed ? "sr-only" : ""}>{label}</span>
                        </Link>,
                      )
                    : named(
                        `${label} · ${AUTH_COPY.soon}`,
                        <span
                          tabIndex={collapsed ? 0 : undefined}
                          className={`${ROW} text-subtle ${collapsed ? "w-9 justify-center" : "px-3"}`}
                        >
                          <Icon aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
                          <span className={collapsed ? "sr-only" : ""}>{label}</span>
                          <span className={collapsed ? "sr-only" : "ml-auto text-xs"}>
                            {AUTH_COPY.soon}
                          </span>
                        </span>,
                      )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {collapsed ? null : (
        <div className="px-3 pb-3">
          <SetupGuide key={active.profileId} />
        </div>
      )}
      {pageAllowed(active, APP_ROUTES.settings) ? (
        <div className={`pb-2 ${collapsed ? "grid justify-center px-2" : "px-3"}`}>
          {named(
            AUTH_COPY.settings,
            <Link
              href={APP_ROUTES.settings}
              aria-current={SETTINGS_PATHS.includes(pathname) ? "page" : undefined}
              className={`${ROW} text-muted transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-ink ${collapsed ? "w-9 justify-center" : "px-3"}`}
            >
              <Settings aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
              <span className={collapsed ? "sr-only" : ""}>{AUTH_COPY.settings}</span>
            </Link>,
          )}
        </div>
      ) : null}
      <div className={`border-t border-line ${collapsed ? "grid place-items-center py-3" : "p-3"}`}>
        {collapsed ? (
          <AccountMenu
            email={email}
            onSignOut={onSignOut}
            side="right"
            trigger={
              <IconButton label={`${AUTH_COPY.account}: ${email}`} size="md">
                <AccountInitial email={email} />
              </IconButton>
            }
          />
        ) : (
          <AccountMenu email={email} onSignOut={onSignOut} />
        )}
      </div>
    </aside>
  );
}
