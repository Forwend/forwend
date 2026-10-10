"use client";

import { LogoMark, Tooltip } from "@forwend/ui-web";
import Link from "next/link";
import type { ReactElement } from "react";
import { AccountInitial, AccountMenu } from "@/features/auth/account-menu";
import { AUTH_COPY } from "@/features/auth/auth-copy";
import { ProfileSwitcher } from "@/features/profiles/components/profile-switcher";
import type { Profile } from "@/features/profiles/profile";
import { APP_NAV } from "@/screens/app-shell/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

const SIDEBAR_COPY = {
  home: "Forwend overview",
  nav: "Main",
} as const;

const ROW =
  "flex h-8 items-center gap-2.5 rounded-sm px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-focus";

export function AppSidebar({
  profiles,
  active,
  onSwitch,
  pathname,
  email,
  onSignOut,
  collapsed,
}: {
  profiles: Profile[];
  active: Profile;
  onSwitch: (profileId: string) => void;
  pathname: string;
  email: string;
  onSignOut: () => void;
  collapsed: boolean;
}) {
  const named = (label: string, node: ReactElement) =>
    collapsed ? (
      <Tooltip content={label} side="right">
        {node}
      </Tooltip>
    ) : (
      node
    );

  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
      <div
        className={`flex h-14 shrink-0 items-center gap-2 border-b border-line ${collapsed ? "justify-center" : "px-3"}`}
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
        className={`flex-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-3"}`}
      >
        {APP_NAV[active.kind].map((group) => (
          <div key={group.label} className={collapsed ? "mb-3" : "mb-5"}>
            <h2 className={collapsed ? "sr-only" : "px-2 pb-1.5 text-xs font-medium text-subtle"}>
              {group.label}
            </h2>
            <ul className="flex flex-col gap-px">
              {group.items.map(({ href, label, icon: Icon }) => (
                <li key={label} className={collapsed ? "grid justify-center" : ""}>
                  {href
                    ? named(
                        label,
                        <Link
                          href={href}
                          aria-current={pathname === href ? "page" : undefined}
                          className={`${ROW} text-muted transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-ink ${collapsed ? "w-8 justify-center px-0" : ""}`}
                        >
                          <Icon aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
                          <span className={collapsed ? "sr-only" : ""}>{label}</span>
                        </Link>,
                      )
                    : // Not built yet: a line of text, not a link.
                      named(
                        `${label} · ${AUTH_COPY.soon}`,
                        <span
                          tabIndex={collapsed ? 0 : undefined}
                          className={`${ROW} text-subtle ${collapsed ? "w-8 justify-center px-0" : ""}`}
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

      <div className={`border-t border-line ${collapsed ? "grid place-items-center py-3" : "p-3"}`}>
        {collapsed ? (
          <AccountMenu
            email={email}
            onSignOut={onSignOut}
            side="right"
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
        ) : (
          <AccountMenu email={email} onSignOut={onSignOut} />
        )}
      </div>
    </aside>
  );
}
