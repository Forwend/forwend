import type {
  createJobBodySchema,
  jobSchema,
  jobsPageSchema,
  publicJobSchema,
} from "@/features/jobs/schemas/jobs";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type JobsSchemasMatchTheSpec = [
  Check<Accepts<typeof jobsPageSchema, ApiAnswer<"/v1/profiles/{profileId}/jobs", "get">>>,
  Check<Accepts<typeof jobSchema, ApiAnswer<"/v1/profiles/{profileId}/jobs/{jobId}", "get">>>,
  Check<Accepts<typeof jobSchema, ApiAnswer<"/v1/profiles/{profileId}/jobs", "post">>>,
  Check<Sends<typeof createJobBodySchema, ApiBody<"/v1/profiles/{profileId}/jobs", "post">>>,
  Check<Accepts<typeof publicJobSchema, ApiAnswer<"/v1/jobs/{token}", "get">>>,
  Check<Accepts<typeof publicJobSchema, ApiAnswer<"/v1/jobs/{token}/accept", "post">>>,
  Check<
    Accepts<
      typeof jobSchema,
      ApiAnswer<"/v1/profiles/{profileId}/jobs/{jobId}/payments/{position}/done", "post">
    >
  >,
  Check<
    Accepts<typeof jobSchema, ApiAnswer<"/v1/profiles/{profileId}/jobs/{jobId}/payments", "post">>
  >,
  Check<
    Accepts<
      typeof publicJobSchema,
      ApiAnswer<"/v1/jobs/{token}/payments/{position}/accept", "post">
    >
  >,
];
