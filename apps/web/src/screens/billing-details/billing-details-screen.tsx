"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { useAppSession } from "@/features/profiles/app-session";
import { BillingDetailsForm } from "@/features/profiles/components/billing-details-form";
import { useGetBillingDetailsQuery } from "@/features/profiles/profiles-api";
import { BILLING_DETAILS_COPY as COPY } from "@/features/profiles/profiles-copy";

export function BillingDetailsScreen() {
  const { profile } = useAppSession();
  const details = useGetBillingDetailsQuery(profile.profileId);
  return (
    <div className="flex max-w-md flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {details.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.loadFailed}
          <Button size="sm" variant="secondary" onClick={details.refetch}>
            {COPY.retry}
          </Button>
        </div>
      ) : details.currentData === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        // A new form per profile, so a profile switch never keeps the last one's values.
        <BillingDetailsForm
          key={profile.profileId}
          profileId={profile.profileId}
          saved={details.currentData}
        />
      )}
    </div>
  );
}
