import { z } from "zod";
import { JOBS_PAGE_SIZE } from "@/features/jobs/constants/jobs";
import {
  createJobBodySchema,
  jobSchema,
  jobsPageSchema,
  publicJobSchema,
} from "@/features/jobs/schemas/jobs";
import type { CreateJobBody, Job, JobsPage, PublicJob } from "@/features/jobs/types/jobs";
import { apiSlice } from "@/shared/api/api-slice";

const JOBS_TAG = "Jobs";
const PUBLIC_JOB_TAG = "PublicJob";

const jobsUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/jobs`;
const jobUrl = (profileId: string, jobId: string) =>
  `${jobsUrl(profileId)}/${encodeURIComponent(jobId)}`;

export const jobsApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [JOBS_TAG, PUBLIC_JOB_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
      /** q matches the title or the client's name. */
      listJobs: build.infiniteQuery<JobsPage, { profileId: string; q?: string }, string | null>({
        infiniteQueryOptions: {
          initialPageParam: null,
          getNextPageParam: (last) => last.nextCursor,
        },
        query: ({ queryArg: { profileId, q }, pageParam }) => ({
          url: jobsUrl(profileId),
          params: {
            limit: JOBS_PAGE_SIZE,
            ...(q ? { q } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
        responseSchema: jobsPageSchema,
        providesTags: [JOBS_TAG],
      }),
      /** The owner's read: the client, the link token and each payment's invoice; 404 for another profile's. */
      getJob: build.query<Job, { profileId: string; jobId: string }>({
        query: ({ profileId, jobId }) => jobUrl(profileId, jobId),
        responseSchema: jobSchema,
        providesTags: [JOBS_TAG],
      }),
      /** One key per filled-in form, so a retried create makes one job (R-100). */
      createJob: build.mutation<
        Job,
        { profileId: string; idempotencyKey: string; body: CreateJobBody }
      >({
        query: ({ profileId, idempotencyKey, body }) => ({
          url: jobsUrl(profileId),
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        }),
        argSchema: z.object({
          profileId: z.guid(),
          idempotencyKey: z.string().min(1),
          body: createJobBodySchema,
        }),
        responseSchema: jobSchema,
        invalidatesTags: [JOBS_TAG],
      }),
      /** The client's read by its link (R-102): public, without the client block; 404 for a link that is not one. */
      getPublicJob: build.query<PublicJob, string>({
        query: (token) => `/v1/jobs/${encodeURIComponent(token)}`,
        responseSchema: publicJobSchema,
        providesTags: [PUBLIC_JOB_TAG],
      }),
      /** The client accepts with a typed name and email (R-100): public, the same answer twice. */
      acceptJob: build.mutation<PublicJob, { token: string; name: string; email: string }>({
        query: ({ token, name, email }) => ({
          url: `/v1/jobs/${encodeURIComponent(token)}/accept`,
          method: "POST",
          body: { name, email },
        }),
        responseSchema: publicJobSchema,
        invalidatesTags: [PUBLIC_JOB_TAG],
      }),
      /** Marks a step of an accepted job done, which makes its invoice (R-103); in order, the same answer twice. */
      markPaymentDone: build.mutation<
        Job,
        { profileId: string; jobId: string; position: number; deliveryLink: string }
      >({
        query: ({ profileId, jobId, position, deliveryLink }) => ({
          url: `${jobUrl(profileId, jobId)}/payments/${position}/done`,
          method: "POST",
          body: { deliveryLink },
        }),
        responseSchema: jobSchema,
        invalidatesTags: [JOBS_TAG],
      }),
      /** Proposes a scope change at the end of an accepted job (R-105); one key per filled-in form. */
      proposeChange: build.mutation<
        Job,
        {
          profileId: string;
          jobId: string;
          idempotencyKey: string;
          body: { title: string; amountUsd: string; dueDays: number };
        }
      >({
        query: ({ profileId, jobId, idempotencyKey, body }) => ({
          url: `${jobUrl(profileId, jobId)}/payments`,
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        }),
        responseSchema: jobSchema,
        invalidatesTags: [JOBS_TAG],
      }),
      /** R-105. */
      withdrawChange: build.mutation<void, { profileId: string; jobId: string; position: number }>({
        query: ({ profileId, jobId, position }) => ({
          url: `${jobUrl(profileId, jobId)}/payments/${position}`,
          method: "DELETE",
        }),
        invalidatesTags: [JOBS_TAG],
      }),
      /** The client accepts a change: proposedAt is the read's string, untouched, so it names that exact change. */
      acceptChange: build.mutation<
        PublicJob,
        { token: string; position: number; proposedAt: string; name: string; email: string }
      >({
        query: ({ token, position, proposedAt, name, email }) => ({
          url: `/v1/jobs/${encodeURIComponent(token)}/payments/${position}/accept`,
          method: "POST",
          body: { name, email, proposedAt },
        }),
        responseSchema: publicJobSchema,
        invalidatesTags: [PUBLIC_JOB_TAG],
      }),
      /** Before the client accepts (R-101); 409 job_accepted after. */
      deleteJob: build.mutation<void, { profileId: string; jobId: string }>({
        query: ({ profileId, jobId }) => ({ url: jobUrl(profileId, jobId), method: "DELETE" }),
        invalidatesTags: [JOBS_TAG],
      }),
    }),
  });

export const {
  useListJobsInfiniteQuery,
  useGetJobQuery,
  useCreateJobMutation,
  useDeleteJobMutation,
  useMarkPaymentDoneMutation,
  useProposeChangeMutation,
  useWithdrawChangeMutation,
  useGetPublicJobQuery,
  useAcceptJobMutation,
  useAcceptChangeMutation,
} = jobsApi;
