import { z } from "zod";
import { ONBOARDING_CHOICES } from "@/features/onboarding/constants/onboarding";
import { PROFILE_KINDS, PROFILE_NAME_MAX } from "@/features/profiles/constants/profile";

const name = z.string().max(PROFILE_NAME_MAX);

/** POST /v1/me/onboarding: what the user wants to do (none to skip), and names for the profiles it makes. */
export const onboardingRequestSchema = z.object({
  choices: z.array(z.enum(ONBOARDING_CHOICES)),
  names: z.object({ [PROFILE_KINDS.freelancer]: name, [PROFILE_KINDS.merchant]: name }).partial(),
});
