import type { MfaMethod } from "@privy-io/react-auth";
import { apiSlice } from "@/shared/api/api-slice";

export const authApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** R-137: ends every session of the user, this one too, so the caller signs out after. */
    signOutEverywhere: build.mutation<void, void>({
      query: () => ({ url: "/v1/me/sign-out-everywhere", method: "POST" }),
    }),
    /** R-137: Forwend emails a 6-digit code for this session; Privy's own sign-in can't prove a confirm (D-49).
     * resendAfterSeconds is how long until another code may be asked for. */
    sendFreshCode: build.mutation<{ resendAfterSeconds: number }, void>({
      query: () => ({ url: "/v1/me/fresh-sign-in", method: "POST" }),
      // A 429 means a code went out a moment ago and is still the one to enter, not a wait.
      extraOptions: { answerFirst: true },
      // Its Retry-After says when another code may go: the step counts down to it.
      transformErrorResponse: (error, meta) => ({
        ...error,
        retryAfterSeconds: Number(meta?.response?.headers.get("Retry-After")) || 0,
      }),
    }),
    /** R-217: before Privy changes the account in the browser; a stale session confirms it's you first (Q-13). */
    checkFreshSignIn: build.mutation<void, void>({
      query: () => ({ url: "/v1/me/fresh-sign-in", method: "GET" }),
    }),
    /** R-219: records the two-step methods at Privy behind a fresh sign-in, once Privy lists each type the user just
     * set up; two-step then stands in for the emailed code on a send (D-49). */
    recordTwoStep: build.mutation<void, readonly MfaMethod[]>({
      query: (methods) => ({ url: "/v1/me/two-step", method: "PUT", body: { methods } }),
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
  useCheckFreshSignInMutation,
  useRecordTwoStepMutation,
} = authApi;
