"use client";

import { buttonClasses, EmptyState, Skeleton } from "@forwend/ui-web";
import { IdCard } from "lucide-react";
import Link from "next/link";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import { JobForm } from "@/features/jobs/components/job-form";
import { JOBS_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { useGetBillingDetailsQuery } from "@/features/profiles/api/profiles-api";
import { BILLING_THEN } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { APP_ROUTES } from "@/shared/config/routes";

// R-101, R-92: billing details first; if they can't be read, the form shows and the API still checks.
export function NewJobScreen() {
  const { profile } = useAppSession();
  const billing = useGetBillingDetailsQuery(profile.profileId);
  // Without the list the form still works: the picker just doesn't show.
  const clients = useListClientsQuery(profile.profileId);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
          {COPY.newTitle}
        </h1>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {billing.currentData === undefined && !billing.isError ? (
        <Skeleton className="h-96" />
      ) : billing.currentData === null ? (
        <EmptyState
          icon={IdCard}
          title={COPY.billingNeeded.title}
          description={COPY.billingNeeded.text}
          action={
            <Link
              href={`${APP_ROUTES.billingDetails}?${BILLING_THEN.param}=${BILLING_THEN.newJob}`}
              className={buttonClasses({ size: "sm" })}
            >
              {COPY.billingNeeded.action}
            </Link>
          }
        />
      ) : (
        <JobForm
          key={profile.profileId}
          profileId={profile.profileId}
          clients={clients.currentData}
        />
      )}
    </div>
  );
}
