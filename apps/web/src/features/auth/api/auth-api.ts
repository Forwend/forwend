import { apiSlice } from "@/shared/api/api-slice";

export const authApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** R-137: ends every session of the user, this one too, so the caller signs out after. */
    signOutEverywhere: build.mutation<void, void>({
      query: () => ({ url: "/v1/me/sign-out-everywhere", method: "POST" }),
    }),
  }),
});

export const { useSignOutEverywhereMutation } = authApi;
