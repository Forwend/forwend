"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { useSearchParams } from "next/navigation";
import { useGetBillingDetailsQuery } from "@/features/profiles/api/profiles-api";
import { BillingDetailsForm } from "@/features/profiles/components/billing-details-form";
import { BILLING_THEN } from "@/features/profiles/constants/profile";
import { BILLING_DETAILS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { APP_ROUTES } from "@/shared/config/routes";

export function BillingDetailsScreen() {
  const { profile } = useAppSession();
  const details = useGetBillingDetailsQuery(profile.profileId);
  // Sent here by New invoice (R-92) or New job (R-101), saving goes back there; otherwise home. Only known places, never
  // a URL from the query.
  const then = useSearchParams().get(BILLING_THEN.param);
  const next =
    then === BILLING_THEN.newInvoice
      ? APP_ROUTES.newInvoice
      : then === BILLING_THEN.newJob
        ? APP_ROUTES.newJob
        : APP_ROUTES.home;
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
          next={next}
        />
      )}
    </div>
  );
}
