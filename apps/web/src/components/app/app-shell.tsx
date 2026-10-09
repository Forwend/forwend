"use client";

import { Button, LogoMark, SelectField, Spinner, ThemeSwitch } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { APP_COPY, APP_ROUTES } from "@/constants/app";
import { signUp } from "@/lib/api";
import { profileLabel } from "@/lib/profile";
import type { Profile } from "@/types/app/profile";
import type { AppSession } from "@/types/app/session";
import { AppSessionContext } from "./active-profile";

// A 44px square with only the icon on phones; icon and label, or label alone, from sm up.
const HEADER_ACTION =
  "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-pill text-sm font-medium text-ink transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 aria-[current=page]:bg-surface-2 sm:px-4";

// Signed out: go to sign-in. Signed in: POST /v1/me (signs up on the first visit), then the top bar with
// the profile and theme switchers, and the page for the chosen profile.
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
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

  return (
    <div className="min-h-dvh bg-bg">
      {/* One row on every screen: home, the profile and its actions, then theme and sign out. */}
      <header className="sticky top-0 z-10 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 md:gap-3 md:px-8">
          <Link
            href={APP_ROUTES.home}
            aria-label={APP_COPY.home}
            className="mr-1 grid size-11 shrink-0 place-items-center rounded-pill text-ink md:mr-3"
          >
            <LogoMark className="size-[var(--fw-icon-lg)]" />
          </Link>
          <SelectField
            label={APP_COPY.profileLabel}
            hideLabel
            className="min-w-0 flex-1 sm:max-w-64"
            value={active.profileId}
            onValueChange={setActiveId}
            options={profiles.map((p) => ({ value: p.profileId, label: profileLabel(p) }))}
          />
          <Link
            href={APP_ROUTES.newProfile}
            aria-label={APP_COPY.newProfile}
            aria-current={pathname === APP_ROUTES.newProfile ? "page" : undefined}
            className={HEADER_ACTION}
          >
            <Plus aria-hidden className="size-[var(--fw-icon-md)] shrink-0" />
            <span className="hidden sm:inline">{APP_COPY.newProfile}</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeSwitch className="size-11" />
            <button
              type="button"
              aria-label={APP_COPY.signOut}
              className={HEADER_ACTION}
              onClick={signOut}
            >
              <LogOut aria-hidden className="size-[var(--fw-icon-md)] shrink-0 sm:hidden" />
              <span className="hidden sm:inline">{APP_COPY.signOut}</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-10">
        <AppSessionContext value={session}>{children}</AppSessionContext>
      </main>
    </div>
  );
}
