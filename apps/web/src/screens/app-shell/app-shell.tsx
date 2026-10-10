"use client";

import { Button, Spinner } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { skipToken } from "@reduxjs/toolkit/query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AUTH_COPY } from "@/features/auth/auth-copy";
import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { type AppSession, AppSessionContext } from "@/features/profiles/app-session";
import { ProfileSheet } from "@/features/profiles/components/profile-sheet";
import { useSignUpQuery } from "@/features/profiles/profiles-api";
import { ReceiveSheet } from "@/features/receive/receive-sheet";
import { AppHeader } from "@/screens/app-shell/app-header";
import { AppSidebar } from "@/screens/app-shell/app-sidebar";
import { CommandMenu } from "@/screens/app-shell/command-menu";
import { PhoneTabBar } from "@/screens/app-shell/phone-tab-bar";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

const COLLAPSED_KEY = "forwend:sidebar-collapsed";

const SHELL_COPY = {
  loading: "Loading your profiles",
  loadFailed: "We could not load your profiles. Try again, or sign out and sign in again.",
  retry: "Try again",
} as const;

// Signed out: go to sign-in. Signed in: POST /v1/me (signs up on the first visit), then the frame (sidebar and header
// on desktop; top bar and tab bar on phones) around the page for the chosen profile. The frame owns what opens from
// anywhere: Receive, the ⌘K menu and the phone profile sheet.
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const me = useSignUpQuery(ready && authenticated ? undefined : skipToken);
  const profiles = me.currentData?.profiles ?? null;
  const [activeId, setActiveId] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // The chosen profile, or the first (personal) one until the user picks another.
  const active = profiles?.find((p) => p.profileId === activeId) ?? profiles?.[0];
  const balances = useGetBalancesQuery(active ? active.profileId : skipToken, LIVE_QUERY);

  useEffect(() => {
    if (ready && !authenticated) router.replace(APP_ROUTES.signIn);
  }, [ready, authenticated, router]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked: the sidebar starts open.
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((was) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, was ? "0" : "1");
      } catch {
        // Storage blocked: the choice lasts for this page view.
      }
      return !was;
    });
  };

  const session = useMemo<AppSession | null>(
    () =>
      profiles && active
        ? {
            profile: active,
            profiles,
            chooseProfile: setActiveId,
            openReceive: () => setReceiving(true),
            openProfiles: () => setChoosing(true),
          }
        : null,
    [profiles, active],
  );

  // Signing out also gives the next user a fresh, empty store (StoreProvider).
  const signOut = async () => {
    await logout();
    router.replace(APP_ROUTES.signIn);
  };
  // Signed up users always have a personal profile; none means the answer is wrong, not that it is loading.
  if (me.isError || (profiles && !active)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-4">
        <div role="alert" className="flex flex-col items-center gap-4 text-center">
          <p className="text-ink">{SHELL_COPY.loadFailed}</p>
          <div className="flex gap-2">
            <Button onClick={() => void me.refetch()}>{SHELL_COPY.retry}</Button>
            <Button variant="ghost" onClick={signOut}>
              {AUTH_COPY.signOut}
            </Button>
          </div>
        </div>
      </main>
    );
  }
  // Also after sign out, until the redirect: never show the shell to a signed-out visitor.
  if (!ready || !authenticated || !profiles || !active || !session) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <Spinner label={SHELL_COPY.loading} />
      </main>
    );
  }

  const email = user?.email?.address ?? user?.google?.email ?? AUTH_COPY.signedIn;
  return (
    <div
      className={`min-h-dvh bg-bg lg:grid ${collapsed ? "lg:grid-cols-[4rem_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]"}`}
    >
      <AppSidebar
        profiles={profiles}
        active={active}
        onSwitch={setActiveId}
        pathname={pathname}
        email={email}
        onSignOut={signOut}
        collapsed={collapsed}
      />
      <div className="min-w-0">
        <AppHeader
          active={active}
          pathname={pathname}
          email={email}
          onSignOut={signOut}
          onSearch={() => setSearching(true)}
          onReceive={() => setReceiving(true)}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
        <main className="px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:pb-10">
          <AppSessionContext value={session}>{children}</AppSessionContext>
        </main>
      </div>
      <PhoneTabBar pathname={pathname} onProfiles={() => setChoosing(true)} />
      <ProfileSheet
        profiles={profiles}
        active={active}
        onSwitch={setActiveId}
        open={choosing}
        onOpenChange={setChoosing}
      />
      <ReceiveSheet
        open={receiving}
        onOpenChange={setReceiving}
        address={active.walletAddress}
        balances={balances.currentData ?? null}
        failed={balances.isError}
        onRetry={balances.refetch}
      />
      <CommandMenu
        open={searching}
        onOpenChange={setSearching}
        profiles={profiles}
        active={active}
        onSwitch={setActiveId}
        onReceive={() => setReceiving(true)}
      />
    </div>
  );
}
