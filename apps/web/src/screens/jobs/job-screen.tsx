"use client";

import { Button, buttonClasses, Skeleton } from "@forwend/ui-web";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useGetJobQuery } from "@/features/jobs/api/jobs-api";
import { JobActions } from "@/features/jobs/components/job-actions";
import { JobDetail } from "@/features/jobs/components/job-detail";
import { JOBS_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

const NOT_FOUND = 404;

export interface JobScreenProps {
  jobId: string;
}

// R-101. Read live, so an acceptance and each payment's status show without a reload.
export function JobScreen({ jobId }: JobScreenProps) {
  const { profile } = useAppSession();
  const job = useGetJobQuery({ profileId: profile.profileId, jobId }, LIVE_QUERY);
  // Once deleted, the page waits to leave instead of saying the job is gone.
  const [deleted, setDeleted] = useState(false);
  // A delete the client's acceptance beat: once the refetch shows it, the menu and its dialog are gone, so focus moves
  // to the heading.
  const [tooLate, setTooLate] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const status = (job.error as { status?: unknown } | undefined)?.status;
  const data = job.currentData;
  const accepted = Boolean(data?.acceptedAt);
  useEffect(() => {
    if (tooLate && accepted) {
      heading.current?.focus();
      setTooLate(false);
    }
  }, [tooLate, accepted]);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <h1
          ref={heading}
          tabIndex={-1}
          className="min-w-0 text-2xl font-semibold tracking-tight break-words text-ink outline-none"
        >
          {data?.title ?? COPY.detailTitle}
        </h1>
        {data && !data.acceptedAt && !deleted ? (
          <JobActions
            profileId={profile.profileId}
            job={data}
            onDeleted={() => setDeleted(true)}
            onTooLate={() => setTooLate(true)}
          />
        ) : null}
      </header>
      {data && !deleted ? (
        <JobDetail profileId={profile.profileId} job={data} />
      ) : status === NOT_FOUND && !deleted ? (
        <div className="flex flex-col items-start gap-3 text-sm text-muted">
          {COPY.gone}
          <Link
            href={APP_ROUTES.jobs}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {COPY.backToList}
          </Link>
        </div>
      ) : job.isError && !deleted ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void job.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : (
        <Skeleton className="h-96" />
      )}
    </div>
  );
}
