import { z } from "zod";
import { ONBOARDING_CHOICES } from "@/features/onboarding/constants/onboarding";

/** POST /v1/me/onboarding: what the user wants to do, or none to skip. */
export const onboardingChoicesSchema = z.array(z.enum(ONBOARDING_CHOICES));
