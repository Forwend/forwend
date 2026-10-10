import type { BillingDetails, BillingDetailsBody } from "@/features/profiles/billing-details";
import type { Me, Profile, ProfileKind } from "@/features/profiles/profile";
import { apiSlice } from "@/shared/api/api-slice";

const NOT_FOUND = 404;

const billingDetailsUrl = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/billing-details`;

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
    /** null until the profile saves them (404 billing_details_not_found). */
    getBillingDetails: build.query<BillingDetails | null, string>({
      query: (profileId) => ({
        url: billingDetailsUrl(profileId),
        validateStatus: (response) => response.ok || response.status === NOT_FOUND,
      }),
      transformResponse: (data: BillingDetails, meta) =>
        meta?.response?.status === NOT_FOUND ? null : data,
    }),
    saveBillingDetails: build.mutation<
      BillingDetails,
      { profileId: string; body: BillingDetailsBody }
    >({
      query: ({ profileId, body }) => ({ url: billingDetailsUrl(profileId), method: "PUT", body }),
      async onQueryStarted({ profileId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getBillingDetails", profileId, data));
        } catch {
          // The form shows the error.
        }
      },
    }),
  }),
});

export const {
  useSignUpQuery,
  useCreateProfileMutation,
  useGetBillingDetailsQuery,
  useSaveBillingDetailsMutation,
} = profilesApi;
