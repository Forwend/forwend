"use client";
import { buttonClasses } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useGetPaymentsInfiniteQuery } from "@/features/payments/api/payments-api";
import { PaymentsTable } from "@/features/payments/components/payments-table";
import { PAYMENTS_COPY as COPY } from "@/features/payments/constants/payments-copy";
import { LoadError } from "@/shared/components/load-error";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

const SHOWN = 6;

/** The overview's newest customer payments; the same first page the Payments list reads, so no second request. */
export function LatestPayments({ profileId }: { profileId: string }) {
  const list = useGetPaymentsInfiniteQuery({ profileId, filters: {} }, LIVE_QUERY);
  const rows = list.currentData?.pages[0]?.items.slice(0, SHOWN);
  return (
    <section aria-labelledby="latest-payments" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="latest-payments" className="text-base font-semibold text-ink">
          {COPY.latest}
        </h2>
        <Link
          href={APP_ROUTES.payments}
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          {COPY.viewAll}
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
        </Link>
      </div>
      {list.isError && !rows ? (
        <LoadError message={COPY.failed} onRetry={() => void list.refetch()} />
      ) : !rows ? (
        <RowsSkeleton count={3} className="fw-panel" />
      ) : rows.length === 0 ? (
        <p className="fw-panel px-4 py-4 text-sm text-muted sm:px-5">{COPY.emptyText}</p>
      ) : (
        <PaymentsTable rows={rows} />
      )}
    </section>
  );
}
