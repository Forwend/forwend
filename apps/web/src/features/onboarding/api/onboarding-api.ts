import { onboardingRequestSchema } from "@/features/onboarding/schemas/onboarding";
import type { OnboardingRequest } from "@/features/onboarding/types/onboarding";
import { profilesApi } from "@/features/profiles/api/profiles-api";
import { meSchema } from "@/features/profiles/schemas/profiles";
import type { Me } from "@/features/profiles/types/profile";
import { apiSlice } from "@/shared/api/api-slice";

export const onboardingApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    completeOnboarding: build.mutation<Me, OnboardingRequest>({
      query: (body) => ({ url: "/v1/me/onboarding", method: "POST", body }),
      argSchema: onboardingRequestSchema,
      responseSchema: meSchema,
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("signUp", undefined, data));
        } catch {
          // Shown by the screen.
        }
      },
    }),
  }),
});

export const { useCompleteOnboardingMutation } = onboardingApi;
