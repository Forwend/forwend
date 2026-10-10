import type { OnboardingChoice } from "@/features/onboarding/onboarding";
import type { Me } from "@/features/profiles/profile";
import { profilesApi } from "@/features/profiles/profiles-api";
import { apiSlice } from "@/shared/api/api-slice";

export const onboardingApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** POST /v1/me/onboarding: makes the chosen profiles once; an empty list is Skip. */
    completeOnboarding: build.mutation<Me, OnboardingChoice[]>({
      query: (choices) => ({ url: "/v1/me/onboarding", method: "POST", body: { choices } }),
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
