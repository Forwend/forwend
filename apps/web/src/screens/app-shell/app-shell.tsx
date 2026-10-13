"use client";

import { Button, Spinner, ToastProvider } from "@forwend/ui-web";
import { usePrivy } from "@privy-io/react-auth";
import { skipToken } from "@reduxjs/toolkit/query";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { PaymentToasts } from "@/features/activity/components/payment-toasts";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { FirstRun } from "@/features/onboarding/components/first-run";
import { useSignUpQuery } from "@/features/profiles/api/profiles-api";
import { ProfileSheet } from "@/features/profiles/components/profile-sheet";
import { AppSessionContext } from "@/features/profiles/hooks/use-app-session";
import {
  chosenProfile,
  readChosenProfileId,
  saveChosenProfileId,
} from "@/features/profiles/lib/chosen-profile";
import type { AppSession } from "@/features/profiles/types/app-session";
import { ReceiveSheet } from "@/features/receive/components/receive-sheet";
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
// anywhere: Receive, a personal profile's Request, the ⌘K menu and the phone profile sheet.
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const me = useSignUpQuery(ready && authenticated ? undefined : skipToken);
  const profiles = me.currentData?.profiles ?? null;
  const userId = user?.id;
  // Read while the profiles load, so the remembered profile is the first one shown.
  const savedId = useMemo(() => (userId ? readChosenProfileId(userId) : null), [userId]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const active = profiles ? chosenProfile(profiles, activeId ?? savedId) : undefined;
  const balances = useGetBalancesQuery(active ? active.profileId : skipToken, LIVE_QUERY);

  const switchProfile = useCallback(
    (profileId: string) => {
      setActiveId(profileId);
      if (userId) saveChosenProfileId(userId, profileId);
      // Another profile starts at its own overview (R-76).
      router.push(APP_ROUTES.home);
    },
    [userId, router],
  );

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
            chooseProfile: switchProfile,
            openReceive: () => setReceiving(true),
            // A request is a form of its own, on a page (R-71).
            openRequest: () => router.push(APP_ROUTES.newInvoice),
          }
        : null,
    [profiles, active, switchProfile, router],
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

  // R-50: the first-run choice, once, before the shell.
  if (me.currentData?.onboardedAt === null) {
    return (
      <FirstRun
        profiles={profiles}
        onDone={(profile) => {
          switchProfile(profile.profileId);
          router.replace(APP_ROUTES.home);
        }}
      />
    );
  }

  const email = user?.email?.address ?? user?.google?.email ?? AUTH_COPY.signedIn;
  return (
    // Phones: toasts sit above the tab bar (h-16, its top border and the safe area).
    <ToastProvider className="max-lg:bottom-[calc(4rem+1px+env(safe-area-inset-bottom)+1rem)]">
      <div className="min-h-dvh bg-bg">
        <PaymentToasts profileId={active.profileId} />
        <AppSidebar
          profiles={profiles}
          active={active}
          onSwitch={switchProfile}
          pathname={pathname}
          email={email}
          onSignOut={signOut}
          collapsed={collapsed}
        />
        {/* The sidebar is fixed on desktop; the content starts after it. */}
        <div className={`min-w-0 ${collapsed ? "lg:pl-16" : "lg:pl-64"}`}>
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
          onSwitch={switchProfile}
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
          onSwitch={switchProfile}
          onReceive={() => setReceiving(true)}
          onRequest={() => router.push(APP_ROUTES.newInvoice)}
        />
      </div>
    </ToastProvider>
  );
}
