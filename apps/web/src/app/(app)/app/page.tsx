"use client";

import { useAppSession } from "@/components/app/active-profile";
import { ActivityList } from "@/components/app/activity-list";
import { MoneySummary } from "@/components/app/money-summary";
import { ReceivePanel } from "@/components/app/receive-panel";
import { REFRESH_MS } from "@/constants/app";
import { PROFILE_PAGE_COPY } from "@/constants/profile-page";
import { getBalances } from "@/lib/api";
import { profileLabel } from "@/lib/profile";
import { useLoad } from "@/lib/use-load";

// The amount first, then activity; Receive sits beside them on wide screens and right after the amount on phones.
// The switcher already names the profile, so the page title is for screen readers only.
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

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:gap-x-16">
      <h1 className="sr-only">
        {profileLabel(profile)} {PROFILE_PAGE_COPY.overview}
      </h1>
      <MoneySummary
        balances={balances.data}
        failed={balances.failed}
        updatedAt={balances.updatedAt}
        onRetry={balances.reload}
      />
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <ReceivePanel
          address={profile.walletAddress}
          balances={balances.data}
          failed={balances.failed}
          onRetry={balances.reload}
        />
      </div>
      <ActivityList profileId={profile.profileId} token={token} />
    </div>
  );
}
