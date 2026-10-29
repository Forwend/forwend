"use client";

import { Skeleton } from "@forwend/ui-web";
import { useSearchParams } from "next/navigation";
import { useGetBillingDetailsQuery } from "@/features/profiles/api/profiles-api";
import { BillingDetailsForm } from "@/features/profiles/components/billing-details-form";
import { BILLING_THEN, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { BILLING_DETAILS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";

export function BillingDetailsScreen() {
  const { profile } = useAppSession();
  const details = useGetBillingDetailsQuery(profile.profileId);
  // R-92, R-101, R-113. Only known places, never a URL from the query.
  const then = useSearchParams().get(BILLING_THEN.param);
  const next =
    then === BILLING_THEN.newInvoice
      ? APP_ROUTES.newInvoice
      : then === BILLING_THEN.newJob
        ? APP_ROUTES.newJob
        : then === BILLING_THEN.transactions
          ? APP_ROUTES.transactions
          : APP_ROUTES.home;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{COPY.title}</h1>
        <p className="text-sm text-muted">{COPY.intro}</p>
      </div>
      {details.isError ? (
        <LoadError
          message={COPY.loadFailed}
          retrying={details.isFetching}
          onRetry={() => void details.refetch()}
        />
      ) : details.currentData === undefined ? (
        <FormSkeleton />
      ) : (
        // A new form per profile, so a profile switch never keeps the last one's values.
        <BillingDetailsForm
          key={profile.profileId}
          profileId={profile.profileId}
          saved={details.currentData}
          next={next}
          business={profile.kind === PROFILE_KINDS.merchant}
        />
      )}
    </div>
  );
}

/** The two field groups as they will stand, so the page does not jump when the details arrive. */
function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      {[
        ["name", "email"],
        ["address", "country", "taxId"],
      ].map((fields) => (
        <div key={fields[0]} className="fw-panel">
          <div className="fw-panel-head">
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5">
            {fields.map((field) => (
              // The address takes the whole row, as in the form.
              <span
                key={field}
                className={`flex flex-col gap-2 ${field === "address" ? "sm:col-span-2" : ""}`}
              >
                <Skeleton className="h-4 w-28" />
                <Skeleton className={field === "address" ? "h-20" : "h-10"} />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
