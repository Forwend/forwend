"use client";

import { Button, Logo, SelectField, Spinner, ThemeSwitch } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { APP_COPY, APP_NAV, APP_ROUTES } from "@/constants/app";
import { signUp } from "@/lib/api";
import { profileLabel } from "@/lib/profile";
import type { Profile } from "@/types/app/profile";
import { ActiveProfileContext } from "./active-profile";

// Signed out: go to sign-in. Signed in: POST /v1/me (signs up on the first visit), then the sidebar, the top bar with
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
    <div className="min-h-dvh bg-bg md:grid md:grid-cols-[auto_1fr]">
      <aside className="flex items-center gap-6 border-b border-line bg-surface px-4 py-3 md:w-60 md:flex-col md:items-stretch md:border-r md:border-b-0 md:py-6">
        <Logo />
        <nav aria-label="App">
          <ul className="flex gap-1 md:flex-col">
            {APP_NAV.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className="flex items-center gap-2 rounded-pill px-3 py-2 text-muted hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink"
                >
                  <Icon aria-hidden className="size-[var(--fw-icon-md)]" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 py-3 md:px-8">
          <SelectField
            label={APP_COPY.profileLabel}
            className="w-64 max-w-full"
            value={active.profileId}
            onValueChange={setActiveId}
            options={profiles.map((p) => ({ value: p.profileId, label: profileLabel(p) }))}
          />
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            <Button variant="ghost" onClick={signOut}>
              {APP_COPY.signOut}
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">
          <ActiveProfileContext value={active}>{children}</ActiveProfileContext>
        </main>
      </div>
    </div>
  );
}
