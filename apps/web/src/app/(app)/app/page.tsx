"use client";

import { useEffect, useState } from "react";
import { useAppSession } from "@/components/app/active-profile";
import { ActivityList } from "@/components/app/activity-list";
import { BalanceCard } from "@/components/app/balance-card";
import { NetworksCard } from "@/components/app/networks-card";
import { ReceiveSheet } from "@/components/app/receive-sheet";
import { RECEIVE_EVENT, RECEIVE_HASH, REFRESH_MS } from "@/constants/app";
import { PROFILE_PAGE_COPY } from "@/constants/profile-page";
import { getBalances } from "@/lib/api";
import { profileLabel } from "@/lib/profile";
import { useLoad } from "@/lib/use-load";

/** Rows of activity on the dashboard; the rest is on the Activity page. */
const RECENT = 5;

// How much and where, what you can do with it, then what happened lately. Receive opens as a sheet, also from the
// phone tab bar (an event here, #receive from another page).
export default function OverviewPage() {
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
        {profileLabel(profile)} {PROFILE_PAGE_COPY.overview}
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
