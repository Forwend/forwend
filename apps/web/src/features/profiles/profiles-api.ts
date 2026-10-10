import type { Me, Profile, ProfileKind } from "@/features/profiles/profile";
import { apiSlice } from "@/shared/api/api-slice";

export const profilesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** POST /v1/me: signs the user up on the first call, then returns their profiles (oldest first). */
    signUp: build.query<Me, void>({
      query: () => ({ url: "/v1/me", method: "POST" }),
    }),
    /** POST /v1/profiles: one profile per idempotency key, so a retried request never makes two. */
    createProfile: build.mutation<
      Profile,
      { idempotencyKey: string; body: { kind: ProfileKind; name: string } }
    >({
      query: ({ idempotencyKey, body }) => ({
        url: "/v1/profiles",
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body,
      }),
      // The new profile joins the list at once, without asking for the list again.
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            profilesApi.util.updateQueryData("signUp", undefined, (me) => {
              if (!me.profiles.some((p) => p.profileId === data.profileId)) me.profiles.push(data);
            }),
          );
        } catch {
          // The form shows the error.
        }
      },
    }),
  }),
});

export const { useSignUpQuery, useCreateProfileMutation } = profilesApi;
