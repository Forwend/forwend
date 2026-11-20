"use client";

import { Skeleton } from "@forwend/ui-web";
import { useClientSearch } from "@/features/clients/hooks/use-client-search";
import { JobForm } from "@/features/jobs/components/job-form";
import { JOBS_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { useGetBillingDetailsQuery } from "@/features/profiles/api/profiles-api";
import { BillingNeeded } from "@/features/profiles/components/billing-needed";
import { BILLING_THEN } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { PageTitle } from "@/shared/components/page-title";

// Billing details first; if they can't be read, the form shows and the API still checks.
export function NewJobScreen() {
  const { profile } = useAppSession();
  const billing = useGetBillingDetailsQuery(profile.profileId);
  const clientSearch = useClientSearch(profile.profileId);
  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageTitle>{COPY.newTitle}</PageTitle>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {billing.currentData === undefined && !billing.isError ? (
        <Skeleton className="h-96" />
      ) : billing.currentData === null ? (
        <BillingNeeded why={COPY.billingNeeded} then={BILLING_THEN.newJob} />
      ) : (
        <JobForm
          key={profile.profileId}
          profileId={profile.profileId}
          clientSearch={clientSearch}
        />
      )}
    </div>
  );
}
