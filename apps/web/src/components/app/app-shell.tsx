"use client";

import { Button, Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDownLeft, CircleUser, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { APP_COPY, APP_NAV, APP_ROUTES, RECEIVE_EVENT, RECEIVE_HASH } from "@/constants/app";
import { PROFILE_PAGE_COPY } from "@/constants/profile-page";
import { signUp } from "@/lib/api";
import type { Profile } from "@/types/app/profile";
import type { AppSession } from "@/types/app/session";
import { AccountMenu } from "./account-menu";
import { AppSessionContext } from "./active-profile";
import { ProfileSheet } from "./profile-sheet";
import { ProfileSwitcher } from "./profile-switcher";

// A phone tab: icon over label, the whole cell is the target.
const TAB =
  "group flex h-16 flex-col items-center justify-center gap-1 text-xs text-muted outline-none focus-visible:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink";
// The icon's pill marks the current page, as in the sidebar.
const TAB_ICON =
  "grid h-7 w-12 place-items-center rounded-pill transition-colors duration-[var(--fw-duration-fast)] group-aria-[current=page]:bg-surface-2";

// Signed out: go to sign-in. Signed in: POST /v1/me (signs up on the first visit), then the sidebar (profile switcher,
// the profile type's pages, the account) on desktop or the tab bar on phones, and the page for the chosen profile.
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    if (ready && !authenticated) router.replace(APP_ROUTES.signIn);
  }, [ready, authenticated, router]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no access token");
      const me = await signUp(token);
      setProfiles(me.profiles);
      setActiveId((current) => current || (me.profiles[0]?.profileId ?? ""));
    } catch {
      setFailed(true);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (ready && authenticated) void load();
  }, [ready, authenticated, load]);

  const session = useMemo<AppSession | null>(() => {
    const profile = profiles?.find((p) => p.profileId === activeId);
    if (!profiles || !profile) return null;
    return {
      profile,
      profiles,
      token: async () => {
        const token = await getAccessToken();
        if (!token) throw new Error("signed out");
        return token;
      },
      addProfile: (added) => {
        setProfiles((list) =>
          list?.some((p) => p.profileId === added.profileId) ? list : [...(list ?? []), added],
        );
        setActiveId(added.profileId);
      },
    };
  }, [profiles, activeId, getAccessToken]);

  const signOut = async () => {
    await logout();
    router.replace(APP_ROUTES.signIn);
  };
  const active = profiles?.find((p) => p.profileId === activeId);
  // Signed up users always have a personal profile; none means the answer is wrong, not that it is loading.
  if (failed || (profiles && !active)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-4">
        <div role="alert" className="flex flex-col items-center gap-4 text-center">
          <p className="text-ink">{APP_COPY.loadFailed}</p>
          <div className="flex gap-2">
            <Button onClick={() => void load()}>{APP_COPY.retry}</Button>
            <Button variant="ghost" onClick={signOut}>
              {APP_COPY.signOut}
            </Button>
          </div>
        </div>
      </main>
    );
  }
  // Also after sign out, until the redirect: never show the shell to a signed-out visitor.
  if (!ready || !authenticated || !profiles || !active) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <Spinner label={APP_COPY.loading} />
      </main>
    );
  }

  const email = user?.email?.address ?? user?.google?.email ?? APP_COPY.signedIn;
  const nav = APP_NAV[active.kind];
  // The tab bar holds working pages only: Overview and Balances, Receive, then Activity.
  const pages = nav.flatMap((item) => (item.href ? [{ ...item, href: item.href }] : []));
  const isCurrent = (href: string) => pathname === href;

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Desktop: the profile frames the sidebar from the top, the account closes it at the bottom. */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-2 border-r border-line bg-surface p-3 lg:flex">
        <ProfileSwitcher profiles={profiles} active={active} onSwitch={setActiveId} />
        <nav aria-label={APP_COPY.mainNav} className="mt-4">
          <ul className="flex flex-col gap-0.5">
            {nav.map(({ href, label, icon: Icon }) => (
              <li key={label}>
                {href ? (
                  <Link
                    href={href}
                    aria-current={isCurrent(href) ? "page" : undefined}
                    className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-muted transition-colors duration-[var(--fw-duration-fast)] hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_55%,transparent)] hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-ink"
                  >
                    <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
                    {label}
                  </Link>
                ) : (
                  // Not built yet: a line of text, not a link.
                  <span className="flex h-10 items-center gap-3 px-3 text-sm text-subtle">
                    <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
                    {label}
                    <span className="ml-auto text-xs">{APP_COPY.soon}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto border-t border-line pt-2">
          <AccountMenu email={email} onSignOut={signOut} />
        </div>
      </aside>

      <div className="min-w-0">
        {/* Phones: the switcher at the top; pages, Receive and the account in the tab bar below. */}
        <header className="sticky top-0 z-10 border-b border-line bg-bg px-3 py-2 lg:hidden">
          <div>
            <ProfileSheet profiles={profiles} active={active} onSwitch={setActiveId} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          <AppSessionContext value={session}>{children}</AppSessionContext>
        </main>
        <nav
          aria-label={APP_COPY.mainNav}
          className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {pages.slice(0, 2).map((item) => (
              <TabLink key={item.href} {...item} current={isCurrent(item.href)} />
            ))}
            <li className="grid place-items-center">
              <button
                type="button"
                aria-label={PROFILE_PAGE_COPY.receive}
                onClick={() => {
                  // On the dashboard the sheet opens in place; elsewhere it opens after going there.
                  if (pathname === APP_ROUTES.home) window.dispatchEvent(new Event(RECEIVE_EVENT));
                  else router.push(`${APP_ROUTES.home}${RECEIVE_HASH}`);
                }}
                className="-mt-5 grid size-14 place-items-center rounded-pill bg-primary text-on-primary shadow-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <ArrowDownLeft aria-hidden className="size-[var(--fw-icon-lg)]" />
              </button>
            </li>
            {pages.slice(2, 3).map((item) => (
              <TabLink key={item.href} {...item} current={isCurrent(item.href)} />
            ))}
            <li className="grid">
              <AccountMenu
                email={email}
                onSignOut={signOut}
                side="top"
                trigger={
                  <button type="button" className={TAB}>
                    <span className={TAB_ICON}>
                      <CircleUser aria-hidden className="size-[var(--fw-icon-md)]" />
                    </span>
                    {APP_COPY.account}
                  </button>
                }
              />
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}

function TabLink({
  href,
  label,
  icon: Icon,
  current,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  current: boolean;
}) {
  return (
    <li className="grid">
      <Link href={href} aria-current={current ? "page" : undefined} className={TAB}>
        <span className={TAB_ICON}>
          <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
        </span>
        {label}
      </Link>
    </li>
  );
}
