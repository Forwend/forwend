"use client";

import { Skeleton } from "@forwend/ui-web";
import { BriefcaseBusiness } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useGetJobQuery } from "@/features/jobs/api/jobs-api";
import { JobActions } from "@/features/jobs/components/job-actions";
import { JobDetail } from "@/features/jobs/components/job-detail";
import { JOBS_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { DetailHeaderSkeleton } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
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
  const heading = useRef<HTMLSpanElement>(null);
  const status = (job.error as { status?: unknown } | undefined)?.status;
  const data = job.currentData;
  const accepted = Boolean(data?.acceptedAt);
  useEffect(() => {
    if (tooLate && accepted) {
      heading.current?.focus();
      setTooLate(false);
    }
  }, [tooLate, accepted]);

  if (data && !deleted) {
    return (
      <JobDetail
        profileId={profile.profileId}
        job={data}
        titleRef={heading}
        actions={
          data.acceptedAt ? null : (
            <JobActions
              profileId={profile.profileId}
              job={data}
              onDeleted={() => setDeleted(true)}
              onTooLate={() => setTooLate(true)}
            />
          )
        }
      />
    );
  }
  return status === NOT_FOUND && !deleted ? (
    <p className="text-muted">
      {COPY.gone} <RecordLink href={APP_ROUTES.jobs}>{COPY.backToList}</RecordLink>
    </p>
  ) : job.isError && !deleted ? (
    <LoadError message={COPY.failed} onRetry={() => void job.refetch()} retrying={job.isFetching} />
  ) : (
    <div className="flex flex-col gap-6">
      <DetailHeaderSkeleton
        back={{ href: APP_ROUTES.jobs, label: COPY.title }}
        icon={<BriefcaseBusiness aria-hidden />}
        figure={COPY.detail.total}
        actions={<Skeleton className="size-10" />}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Skeleton className="h-80" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
