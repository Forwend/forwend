"use client";

import { useEffect, useState } from "react";
import { ActivityList } from "@/features/activity/activity-list";
import { BalanceCard } from "@/features/balances/balance-card";
import { getBalances } from "@/features/balances/balances-api";
import { NetworksCard } from "@/features/balances/networks-card";
import { useAppSession } from "@/features/profiles/app-session";
import { profileLabel } from "@/features/profiles/profile";
import { RECEIVE_EVENT, RECEIVE_HASH } from "@/features/receive/receive-events";
import { ReceiveSheet } from "@/features/receive/receive-sheet";
import { REFRESH_MS } from "@/shared/config/refresh";
import { useLoad } from "@/shared/hooks/use-load";

const DASHBOARD_COPY = {
  overview: "overview",
} as const;

/** Rows of activity on the dashboard; the rest is on the Activity page. */
const RECENT = 5;

// How much and where, what you can do with it, then what happened lately. Receive opens as a sheet, also from the
// phone tab bar (an event here, #receive from another page).
export function DashboardScreen() {
  const { profile, token } = useAppSession();
  const balances = useLoad(
    async () => getBalances(await token(), profile.profileId),
    [profile.profileId],
    {
      refreshMs: REFRESH_MS,
      resetKey: profile.profileId,
    },
  );
  const [receiving, setReceiving] = useState(false);

  useEffect(() => {
    if (window.location.hash === RECEIVE_HASH) {
      setReceiving(true);
      history.replaceState(null, "", window.location.pathname);
    }
    const open = () => setReceiving(true);
    window.addEventListener(RECEIVE_EVENT, open);
    return () => window.removeEventListener(RECEIVE_EVENT, open);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">
        {profileLabel(profile)} {DASHBOARD_COPY.overview}
      </h1>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <BalanceCard
          balances={balances.data}
          failed={balances.failed}
          updatedAt={balances.updatedAt}
          onRetry={balances.reload}
          onReceive={() => setReceiving(true)}
        />
        <NetworksCard balances={balances.data} />
      </div>
      <ActivityList profileId={profile.profileId} token={token} preview={RECENT} />
      <ReceiveSheet
        open={receiving}
        onOpenChange={setReceiving}
        address={profile.walletAddress}
        balances={balances.data}
        failed={balances.failed}
        onRetry={balances.reload}
      />
    </div>
  );
}
