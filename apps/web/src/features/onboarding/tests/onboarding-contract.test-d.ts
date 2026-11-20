import type { onboardingRequestSchema } from "@/features/onboarding/schemas/onboarding";
import type { meSchema } from "@/features/profiles/schemas/profiles";
import type { Accepts, ApiAnswer, ApiBody, Check, Sends } from "@/shared/types/api-contract";

export type OnboardingSchemasMatchTheSpec = [
  Check<Accepts<typeof meSchema, ApiAnswer<"/v1/me/onboarding", "post">>>,
  Check<Sends<typeof onboardingRequestSchema, ApiBody<"/v1/me/onboarding", "post">>>,
];
