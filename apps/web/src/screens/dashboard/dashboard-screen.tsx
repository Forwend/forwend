"use client";

import { useEffect, useState } from "react";
import { ActivityList } from "@/features/activity/activity-list";
import { BalanceCard } from "@/features/balances/balance-card";
import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { NetworksCard } from "@/features/balances/networks-card";
import { useAppSession } from "@/features/profiles/app-session";
import { profileLabel } from "@/features/profiles/profile";
import { RECEIVE_EVENT, RECEIVE_HASH } from "@/features/receive/receive-events";
import { ReceiveSheet } from "@/features/receive/receive-sheet";
import { LIVE_QUERY } from "@/shared/config/refresh";

const DASHBOARD_COPY = {
  overview: "overview",
} as const;

/** Rows of activity on the dashboard; the rest is on the Activity page. */
const RECENT = 5;

// How much and where, what you can do with it, then what happened lately. Receive opens as a sheet, also from the
// phone tab bar (an event here, #receive from another page).
export function DashboardScreen() {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
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
          balances={balances.currentData ?? null}
          failed={balances.isError}
          updatedAt={balances.fulfilledTimeStamp ? new Date(balances.fulfilledTimeStamp) : null}
          onRetry={balances.refetch}
          onReceive={() => setReceiving(true)}
        />
        <NetworksCard balances={balances.currentData ?? null} />
      </div>
      <ActivityList profileId={profile.profileId} preview={RECENT} />
      <ReceiveSheet
        open={receiving}
        onOpenChange={setReceiving}
        address={profile.walletAddress}
        balances={balances.currentData ?? null}
        failed={balances.isError}
        onRetry={balances.refetch}
      />
    </div>
  );
}
