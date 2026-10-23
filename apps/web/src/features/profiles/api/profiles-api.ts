import { z } from "zod";
import {
  billingDetailsBodySchema,
  billingDetailsSchema,
  createProfileBodySchema,
  meSchema,
  notificationsSchema,
  profileSchema,
} from "@/features/profiles/schemas/profiles";
import type { BillingDetails, BillingDetailsBody } from "@/features/profiles/types/billing-details";
import type { Notifications } from "@/features/profiles/types/notifications";
import type { Me, Profile, ProfileKind } from "@/features/profiles/types/profile";
import { apiSlice } from "@/shared/api/api-slice";

const NOT_FOUND = 404;

const billingDetailsUrl = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/billing-details`;
const notificationsUrl = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/notifications`;

export const profilesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** POST /v1/me: signs the user up on the first call, then returns their profiles (oldest first). */
    signUp: build.query<Me, void>({
      query: () => ({ url: "/v1/me", method: "POST" }),
      responseSchema: meSchema,
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
      argSchema: z.object({ idempotencyKey: z.string().min(1), body: createProfileBodySchema }),
      responseSchema: profileSchema,
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
      responseSchema: billingDetailsSchema.nullable(),
    }),
    saveBillingDetails: build.mutation<
      BillingDetails,
      { profileId: string; body: BillingDetailsBody }
    >({
      query: ({ profileId, body }) => ({ url: billingDetailsUrl(profileId), method: "PUT", body }),
      argSchema: z.object({ profileId: z.guid(), body: billingDetailsBodySchema }),
      responseSchema: billingDetailsSchema,
      async onQueryStarted({ profileId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getBillingDetails", profileId, data));
        } catch {
          // The form shows the error.
        }
      },
    }),
    /** The profile's owner email (R-80). */
    getNotifications: build.query<Notifications, string>({
      query: (profileId) => notificationsUrl(profileId),
      responseSchema: notificationsSchema,
    }),
    saveNotifications: build.mutation<Notifications, { profileId: string; email: boolean }>({
      query: ({ profileId, email }) => ({
        url: notificationsUrl(profileId),
        method: "PUT",
        body: { email },
      }),
      responseSchema: notificationsSchema,
      async onQueryStarted({ profileId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getNotifications", profileId, data));
        } catch {
          // The page shows the error.
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
  useGetNotificationsQuery,
  useSaveNotificationsMutation,
} = profilesApi;
