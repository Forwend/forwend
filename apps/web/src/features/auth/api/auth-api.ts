import type { MfaMethod } from "@privy-io/react-auth";
import { apiSlice } from "@/shared/api/api-slice";

export const authApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    signOutEverywhere: build.mutation<void, void>({
      query: () => ({ url: "/v1/me/sign-out-everywhere", method: "POST" }),
    }),
    sendFreshCode: build.mutation<{ resendAfterSeconds: number }, void>({
      query: () => ({ url: "/v1/me/fresh-sign-in", method: "POST" }),
      // A 429 here means the last code is still the one to enter, not a wait.
      extraOptions: { answerFirst: true },
      transformErrorResponse: (error, meta) => ({
        ...error,
        retryAfterSeconds: Number(meta?.response?.headers.get("Retry-After")) || 0,
      }),
    }),
    checkFreshSignIn: build.mutation<void, void>({
      query: () => ({ url: "/v1/me/fresh-sign-in", method: "GET" }),
    }),
    recordTwoStep: build.mutation<void, readonly MfaMethod[]>({
      query: (methods) => ({ url: "/v1/me/two-step", method: "PUT", body: { methods } }),
    }),
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
