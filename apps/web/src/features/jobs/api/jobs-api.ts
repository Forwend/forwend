import { z } from "zod";
import { JOBS_PAGE_SIZE } from "@/features/jobs/constants/jobs";
import {
  createJobBodySchema,
  jobSchema,
  jobsPageSchema,
  publicJobSchema,
} from "@/features/jobs/schemas/jobs";
import type { CreateJobBody, Job, JobsPage, PublicJob } from "@/features/jobs/types/jobs";
import { apiSlice, profilePath } from "@/shared/api/api-slice";
import type { ApiBody } from "@/shared/types/api-contract";

const JOBS_TAG = "Jobs";
const PUBLIC_JOB_TAG = "PublicJob";

const jobsUrl = (profileId: string) => profilePath(profileId, "jobs");
const jobUrl = (profileId: string, jobId: string) =>
  `${jobsUrl(profileId)}/${encodeURIComponent(jobId)}`;

export const jobsApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [JOBS_TAG, PUBLIC_JOB_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
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
      getJob: build.query<Job, { profileId: string; jobId: string }>({
        query: ({ profileId, jobId }) => jobUrl(profileId, jobId),
        responseSchema: jobSchema,
        providesTags: [JOBS_TAG],
      }),
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
      getPublicJob: build.query<PublicJob, string>({
        query: (token) => `/v1/jobs/${encodeURIComponent(token)}`,
        responseSchema: publicJobSchema,
        providesTags: [PUBLIC_JOB_TAG],
      }),
      acceptJob: build.mutation<PublicJob, { token: string; name: string; email: string }>({
        query: ({ token, name, email }) => ({
          url: `/v1/jobs/${encodeURIComponent(token)}/accept`,
          method: "POST",
          body: { name, email } satisfies ApiBody<"/v1/jobs/{token}/accept", "post">,
        }),
        responseSchema: publicJobSchema,
        invalidatesTags: [PUBLIC_JOB_TAG],
      }),
      markPaymentDone: build.mutation<
        Job,
        { profileId: string; jobId: string; position: number; deliveryLink: string }
      >({
        query: ({ profileId, jobId, position, deliveryLink }) => ({
          url: `${jobUrl(profileId, jobId)}/payments/${position}/done`,
          method: "POST",
          body: { deliveryLink } satisfies ApiBody<
            "/v1/profiles/{profileId}/jobs/{jobId}/payments/{position}/done",
            "post"
          >,
        }),
        responseSchema: jobSchema,
        invalidatesTags: [JOBS_TAG],
      }),
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
          body: body satisfies ApiBody<"/v1/profiles/{profileId}/jobs/{jobId}/payments", "post">,
        }),
        responseSchema: jobSchema,
        invalidatesTags: [JOBS_TAG],
      }),
      withdrawChange: build.mutation<void, { profileId: string; jobId: string; position: number }>({
        query: ({ profileId, jobId, position }) => ({
          url: `${jobUrl(profileId, jobId)}/payments/${position}`,
          method: "DELETE",
        }),
        invalidatesTags: [JOBS_TAG],
      }),
      acceptChange: build.mutation<
        PublicJob,
        { token: string; position: number; proposedAt: string; name: string; email: string }
      >({
        query: ({ token, position, proposedAt, name, email }) => ({
          url: `/v1/jobs/${encodeURIComponent(token)}/payments/${position}/accept`,
          method: "POST",
          body: { name, email, proposedAt } satisfies ApiBody<
            "/v1/jobs/{token}/payments/{position}/accept",
            "post"
          >,
        }),
        responseSchema: publicJobSchema,
        invalidatesTags: [PUBLIC_JOB_TAG],
      }),
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
