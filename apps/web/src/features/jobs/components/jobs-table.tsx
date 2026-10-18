"use client";

import {
  Button,
  type ButtonSize,
  buttonClasses,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  SearchField,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { BriefcaseBusiness, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { useListJobsQuery } from "@/features/jobs/api/jobs-api";
import { JOBS_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents, matchesJob } from "@/features/jobs/lib/jobs";
import type { JobSummary } from "@/features/jobs/types/jobs";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
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

// R-101, laid out like Clients: the toolbar's search on the left and New job at its end (beside the title on phones),
// then a table whose rows open the job. The list comes whole (at most 1000), so the search filters here.
export function JobsTable({ profileId }: JobsTableProps) {
  const list = useListJobsQuery(profileId);
  const [search, setSearch] = useState("");
  const jobs = list.currentData ?? [];
  const rows = jobs.filter((job) => matchesJob(job, search));
  const noJobs = list.currentData && jobs.length === 0;

  return (
    <section
      aria-labelledby="jobs-title"
      aria-busy={!list.currentData && !list.isError}
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
      {list.currentData && !noJobs ? (
        <ListToolbar
          search={
            <SearchField
              label={COPY.search}
              value={search}
              onValueChange={setSearch}
              placeholder={COPY.searchPlaceholder}
              className="flex-1"
            />
          }
          actions={<NewJobLink className="max-lg:hidden" />}
        />
      ) : null}

      {list.isError && !list.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.currentData ? (
        <RowsSkeleton count={SKELETON_ROWS} className="fw-panel" />
      ) : noJobs ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title={COPY.empty}
          description={COPY.emptyText}
          action={<NewJobLink />}
        />
      ) : rows.length === 0 ? (
        <NoMatch onClear={() => setSearch("")} clearLabel={COPY.clearSearch} />
      ) : (
        <div className="fw-panel overflow-hidden">
          {/* Wide screens: a ruled table. Below xl rows stack as on phones, as Clients does. */}
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col" className="w-[32%]">
                    {COPY.columns.job}
                  </th>
                  <th scope="col">{COPY.columns.client}</th>
                  <th scope="col" className="text-right">
                    {COPY.columns.total}
                  </th>
                  <th scope="col">{COPY.columns.state}</th>
                  <th scope="col">{COPY.columns.created}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((job) => (
                  // The title's link covers the row, so the whole row opens the job.
                  <tr
                    key={job.jobId}
                    className={`relative transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} ${ROW_INTERACTIVE_CLASSES}`}
                  >
                    <td className="max-w-72">
                      <Link
                        href={jobHref(job)}
                        title={job.title}
                        className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {job.title}
                      </Link>
                    </td>
                    <td title={job.clientName} className="max-w-56 truncate text-muted">
                      {job.clientName}
                    </td>
                    <td className="text-right tabular-nums text-ink">{total(job)}</td>
                    <td className="text-muted">{state(job)}</td>
                    <td className="text-muted">{DAY.format(new Date(job.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line xl:hidden">
            {rows.map((job) => (
              <li key={job.jobId}>
                <Link
                  href={jobHref(job)}
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{job.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {job.clientName} · {state(job)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums text-ink">
                    {total(job)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
