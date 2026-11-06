import { apiSlice } from "@/shared/api/api-slice";

export const authApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** R-137: ends every session of the user, this one too, so the caller signs out after. */
    signOutEverywhere: build.mutation<void, void>({
      query: () => ({ url: "/v1/me/sign-out-everywhere", method: "POST" }),
    }),
    /** R-137: Forwend emails a 6-digit code for this session; Privy's own sign-in can't prove a confirm (D-49). */
    sendFreshCode: build.mutation<void, void>({
      query: () => ({ url: "/v1/me/fresh-sign-in", method: "POST" }),
      // A 429 means a code went out a moment ago and is still the one to enter, not a wait.
      extraOptions: { answerFirst: true },
    }),
    /** The right code makes this session count as freshly signed in for 15 minutes. */
    verifyFreshCode: build.mutation<void, string>({
      query: (code) => ({ url: "/v1/me/fresh-sign-in/verify", method: "POST", body: { code } }),
    }),
  }),
});

export const {
  useSignOutEverywhereMutation,
  useSendFreshCodeMutation,
  useVerifyFreshCodeMutation,
} = authApi;
