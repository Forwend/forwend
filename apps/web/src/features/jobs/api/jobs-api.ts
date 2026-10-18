import { z } from "zod";
import {
  createJobBodySchema,
  jobSchema,
  jobsSchema,
  publicJobSchema,
} from "@/features/jobs/schemas/jobs";
import type { CreateJobBody, Job, JobSummary, PublicJob } from "@/features/jobs/types/jobs";
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
      /** The profile's jobs, newest first (at most 1000, so one request). */
      listJobs: build.query<JobSummary[], string>({
        query: (profileId) => jobsUrl(profileId),
        rawResponseSchema: jobsSchema,
        transformResponse: (data: { items: JobSummary[] }) => data.items,
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
      /** Before the client accepts (R-101); 409 job_accepted after. */
      deleteJob: build.mutation<void, { profileId: string; jobId: string }>({
        query: ({ profileId, jobId }) => ({ url: jobUrl(profileId, jobId), method: "DELETE" }),
        invalidatesTags: [JOBS_TAG],
      }),
    }),
  });

export const {
  useListJobsQuery,
  useGetJobQuery,
  useCreateJobMutation,
  useDeleteJobMutation,
  useGetPublicJobQuery,
  useAcceptJobMutation,
} = jobsApi;
