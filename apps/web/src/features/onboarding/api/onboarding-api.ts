import { onboardingRequestSchema } from "@/features/onboarding/schemas/onboarding";
import type { OnboardingRequest } from "@/features/onboarding/types/onboarding";
import { profilesApi } from "@/features/profiles/api/profiles-api";
import { meSchema } from "@/features/profiles/schemas/profiles";
import type { Me } from "@/features/profiles/types/profile";
import { apiSlice } from "@/shared/api/api-slice";

export const onboardingApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** POST /v1/me/onboarding: makes the chosen profiles once, named; no choices is Skip. */
    completeOnboarding: build.mutation<Me, OnboardingRequest>({
      query: (body) => ({ url: "/v1/me/onboarding", method: "POST", body }),
      argSchema: onboardingRequestSchema,
      responseSchema: meSchema,
      // The answer is the whole of /v1/me: it replaces the cached one, so the app shows the new profiles at once.
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("signUp", undefined, data));
        } catch {
          // The screen shows the error.
        }
      },
    }),
  }),
});

export const { useCompleteOnboardingMutation } = onboardingApi;
