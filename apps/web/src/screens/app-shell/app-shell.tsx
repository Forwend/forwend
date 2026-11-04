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
import { afterOnboarding } from "@/features/onboarding/lib/onboarding";
import { useSignUpQuery } from "@/features/profiles/api/profiles-api";
import { ProfileSheet } from "@/features/profiles/components/profile-sheet";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { AppSessionContext } from "@/features/profiles/hooks/use-app-session";
import {
  chosenProfile,
  readChosenProfileId,
  saveChosenProfileId,
} from "@/features/profiles/lib/chosen-profile";
import { can } from "@/features/profiles/lib/profile";
import type { AppSession } from "@/features/profiles/types/app-session";
import { ReceiveSheet } from "@/features/receive/components/receive-sheet";
import { AppHeader } from "@/screens/app-shell/app-header";
import { AppSidebar } from "@/screens/app-shell/app-sidebar";
import { CommandMenu } from "@/screens/app-shell/command-menu";
import { firstPage, pageAllowed } from "@/screens/app-shell/lib/app-nav";
import { PhoneTabBar } from "@/screens/app-shell/phone-tab-bar";
import { useRetryUnreachable, useServerUnreachable } from "@/shared/api/server-reach";
import { ServerStrip } from "@/shared/components/server-strip";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

const COLLAPSED_KEY = "forwend:sidebar-collapsed";

const SHELL_COPY = {
  loading: "Loading your profiles",
  loadFailed: "We could not load your profiles. Try again, or sign out and sign in again.",
  retry: "Try again",
  skip: "Skip to content",
} as const;

// Signed in: POST /v1/me (signs up on the first visit), then the frame around the chosen profile's page.
// The frame owns what opens from anywhere: Receive, a personal profile's Request, ⌘K and the phone profile sheet.
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
  const money = active ? can(active, PERMISSIONS.moneyRead) : false;
  // Receive's token list, read only while it is open: a closed sheet polls nothing.
  const balances = useGetBalancesQuery(
    active && money && receiving ? active.profileId : skipToken,
    LIVE_QUERY,
  );
  // One strip under the header says the server can't be reached, in place of each view's own refresh notice.
  const down = useServerUnreachable();
  useRetryUnreachable(down);

  const rememberProfile = useCallback(
    (profileId: string) => {
      setActiveId(profileId);
      if (userId) saveChosenProfileId(userId, profileId);
    },
    [userId],
  );
  const switchProfile = useCallback(
    (profileId: string) => {
      rememberProfile(profileId);
      // Another profile starts at its own overview (R-76).
      router.push(APP_ROUTES.home);
    },
    [rememberProfile, router],
  );

  // R-50: the first run has its own address. Until it is done every app page sends there, keeping the page asked for;
  // once done (also the moment it is finished) the address returns to that page, else the overview.
  const firstRun = me.currentData ? me.currentData.onboardedAt === null : null;
  const onOnboarding = pathname === APP_ROUTES.onboarding;
  useEffect(() => {
    if (firstRun && !onOnboarding) {
      const next = encodeURIComponent(pathname + window.location.search);
      router.replace(`${APP_ROUTES.onboarding}?next=${next}`);
    } else if (firstRun === false && onOnboarding) {
      router.replace(afterOnboarding(new URLSearchParams(window.location.search).get("next")));
    }
  }, [firstRun, onOnboarding, pathname, router]);

  useEffect(() => {
    if (ready && !authenticated) router.replace(APP_ROUTES.signIn);
  }, [ready, authenticated, router]);

  // D-93: a page the profile's role can't use is hidden, so its address leads to the role's first page instead.
  const allowed = !active || pageAllowed(active, pathname);
  useEffect(() => {
    if (active && !allowed) router.replace(firstPage(active));
  }, [active, allowed, router]);

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

  // Signing out also gives the next user a fresh, empty store (StoreProvider).
  const signOut = useCallback(async () => {
    await logout();
    router.replace(APP_ROUTES.signIn);
  }, [logout, router]);

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
            signOut,
          }
        : null,
    [profiles, active, switchProfile, router, signOut],
  );

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
  // Also after sign out, until the redirect: never show the shell to a signed-out visitor. And while the first run's
  // address is still being reached or left.
  if (
    !ready ||
    !authenticated ||
    !profiles ||
    !active ||
    !session ||
    firstRun !== onOnboarding ||
    !allowed
  ) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <Spinner label={SHELL_COPY.loading} />
      </main>
    );
  }

  // R-50
  if (firstRun) {
    return (
      <FirstRun
        profiles={profiles}
        // The finished first run updates onboardedAt, and the address check above returns to the page.
        onDone={(profile) => rememberProfile(profile.profileId)}
      />
    );
  }

  const email = user?.email?.address ?? user?.google?.email ?? AUTH_COPY.signedIn;
  return (
    // Phones: toasts sit above the tab bar, its border and the safe area.
    <ToastProvider className="max-lg:bottom-[calc(5rem+1px+env(safe-area-inset-bottom)+1rem)]">
      <AppSessionContext value={session}>
        <div className="min-h-dvh bg-bg">
          <a
            href="#app-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[var(--fw-z-toast)] focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-on-primary"
          >
            {SHELL_COPY.skip}
          </a>
          {money ? <PaymentToasts profileId={active.profileId} /> : null}
          <AppSidebar
            profiles={profiles}
            active={active}
            onSwitch={switchProfile}
            pathname={pathname}
            email={email}
            onSignOut={signOut}
            collapsed={collapsed}
          />
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
            {down ? (
              <ServerStrip className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-[var(--fw-z-nav)] rounded-none" />
            ) : null}
            <main
              id="app-content"
              tabIndex={-1}
              // A page whose only content is an empty or error state: the workspace is the screen under the header, and
              // every box down to the state grows, so the state stands in the middle of what is left.
              className="fw-safe-x pt-6 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] outline-none has-[[data-page-empty]]:flex has-[[data-page-empty]]:min-h-[calc(100dvh-4rem-env(safe-area-inset-top,0px))] has-[[data-page-empty]]:flex-col sm:pt-8 lg:pb-10 [&_*:has([data-page-empty])]:grow"
            >
              {children}
            </main>
          </div>
          <PhoneTabBar active={active} pathname={pathname} onProfiles={() => setChoosing(true)} />
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
      </AppSessionContext>
    </ToastProvider>
  );
}
