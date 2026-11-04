"use client";

import { Button, type ButtonSize, buttonClasses, EmptyState, SearchField } from "@forwend/ui-web";
import { BriefcaseBusiness, Plus } from "lucide-react";
import Link from "next/link";
import { formatUsd } from "@/features/balances/lib/balances";
import { useListJobsInfiniteQuery } from "@/features/jobs/api/jobs-api";
import { JOBS_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents } from "@/features/jobs/lib/jobs";
import type { JobSummary } from "@/features/jobs/types/jobs";
import { DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { useListSearch } from "@/shared/hooks/use-list-filters";
import { shortDate } from "@/shared/lib/dates";

const jobHref = (job: JobSummary) => `${APP_ROUTES.jobs}/${job.jobId}`;
const total = (job: JobSummary) => `${formatUsd(apiCents(job.totalUsd))} ${MONEY_COPY.usd}`;
const state = (job: JobSummary) =>
  job.acceptedAt ? COPY.accepted(job.paid, job.payments) : COPY.waiting;

function NewJobLink({ className = "", size = "md" }: { className?: string; size?: ButtonSize }) {
  return (
    <Link href={APP_ROUTES.newJob} className={`${buttonClasses({ size })} ${className}`}>
      <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.add}
    </Link>
  );
}

export interface JobsTableProps {
  profileId: string;
}

// R-101, R-177: the API pages and searches the jobs.
export function JobsTable({ profileId }: JobsTableProps) {
  const search = useListSearch();
  const list = useListJobsInfiniteQuery({ profileId, q: search.apiQuery });
  // A new search keeps the last rows in place, dimmed and busy, until its own answer arrives.
  const data = list.currentData ?? (list.isFetching ? list.data : undefined);
  const stale = !list.currentData && Boolean(data);
  const rows = data?.pages.flatMap((page) => page.items) ?? [];
  const noJobs = !search.apiQuery && list.currentData && rows.length === 0;

  return (
    <section
      aria-labelledby="jobs-title"
      aria-busy={(!list.currentData && !list.isError) || undefined}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading and its action show only below that. */}
      <div className="flex items-center justify-between gap-3 lg:contents">
        <h1 id="jobs-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
          {COPY.title}
        </h1>
        {/* An empty list offers it in its own block instead. */}
        {noJobs ? null : <NewJobLink size="sm" className="lg:hidden" />}
      </div>
      {!noJobs ? (
        <ListToolbar
          search={
            <SearchField
              label={COPY.search}
              value={search.search}
              onValueChange={search.setSearch}
              placeholder={COPY.searchPlaceholder}
              className="flex-1"
            />
          }
          actions={<NewJobLink className="max-lg:hidden" />}
        />
      ) : null}

      {list.isError && !data ? (
        <LoadError
          page
          message={COPY.failed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !data ? (
        <DataTableSkeleton count={SKELETON_ROWS} className="fw-panel" />
      ) : noJobs ? (
        <EmptyState
          page
          icon={BriefcaseBusiness}
          title={COPY.empty}
          description={COPY.emptyText}
          action={<NewJobLink />}
        />
      ) : rows.length === 0 ? (
        <NoMatch page onClear={search.clear} clearLabel={COPY.clearSearch} />
      ) : (
        <div
          className={
            stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : undefined
          }
        >
          <DataTable
            label={COPY.title}
            rows={rows}
            rowKey={(job) => job.jobId}
            rowHref={jobHref}
            rowLabel={(job) => job.title}
            columns={[
              {
                key: "job",
                header: COPY.columns.job,
                className: "w-[32%]",
                cell: (job) => <span className="font-medium text-ink">{job.title}</span>,
              },
              {
                key: "client",
                header: COPY.columns.client,
                cell: (job) => <span className="text-muted">{job.clientName}</span>,
              },
              { key: "total", header: COPY.columns.total, align: "end", cell: total },
              {
                key: "state",
                header: COPY.columns.state,
                from: "md",
                cell: (job) => <span className="text-muted">{state(job)}</span>,
              },
              {
                key: "created",
                header: COPY.columns.created,
                align: "end",
                from: "lg",
                cell: (job) => <span className="text-muted">{shortDate(job.createdAt)}</span>,
              },
            ]}
            phone={(job) => ({
              title: job.title,
              detail: `${job.clientName} · ${state(job)}`,
              value: total(job),
            })}
            footer={
              list.hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {COPY.loadMore}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {list.error && data ? (
        <LoadError
          inline
          message={COPY.updateFailed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : null}
    </section>
  );
}
