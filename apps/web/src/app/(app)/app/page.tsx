"use client";

import { Address, EmptyState } from "@forwend/ui-web";
import { useActiveProfile } from "@/components/app/active-profile";
import { APP_COPY } from "@/constants/app";
import { profileLabel } from "@/lib/profile";

export default function OverviewPage() {
  const profile = useActiveProfile();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-3xl text-ink">{profileLabel(profile)}</h1>
      {profile.walletAddress ? <Address address={profile.walletAddress} /> : null}
      <EmptyState title={APP_COPY.overviewEmptyTitle} description={APP_COPY.overviewEmptyBody} />
    </div>
  );
}
