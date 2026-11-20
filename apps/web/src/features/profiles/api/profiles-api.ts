import { z } from "zod";
import {
  billingDetailsBodySchema,
  billingDetailsSchema,
  createProfileBodySchema,
  meSchema,
  notificationsSchema,
  profileFeesSchema,
  profileModeSchema,
  profileSchema,
  profileTokensSchema,
} from "@/features/profiles/schemas/profiles";
import type { BillingDetails, BillingDetailsBody } from "@/features/profiles/types/billing-details";
import type { Notifications } from "@/features/profiles/types/notifications";
import type { FeesPaidBy, Me, NewProfileKind, Profile } from "@/features/profiles/types/profile";
import type { TokenRef, TokenSwitch } from "@/features/profiles/types/tokens";
import { HTTP_STATUS } from "@/shared/api/api-error";
import { apiSlice, profilePath } from "@/shared/api/api-slice";

export const profilesApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** Signs the user up on the first call. */
    signUp: build.query<Me, void>({
      query: () => ({ url: "/v1/me", method: "POST" }),
      responseSchema: meSchema,
    }),
    createProfile: build.mutation<
      Profile,
      { idempotencyKey: string; body: { kind: NewProfileKind; name: string } }
    >({
      query: ({ idempotencyKey, body }) => ({
        url: "/v1/profiles",
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body,
      }),
      argSchema: z.object({ idempotencyKey: z.string().min(1), body: createProfileBodySchema }),
      responseSchema: profileSchema,
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            profilesApi.util.updateQueryData("signUp", undefined, (me) => {
              if (!me.profiles.some((p) => p.profileId === data.profileId)) me.profiles.push(data);
            }),
          );
        } catch {
          // Shown by the form.
        }
      },
    }),
    /** null until saved (404 billing_details_not_found). */
    getBillingDetails: build.query<BillingDetails | null, string>({
      query: (profileId) => ({
        url: profilePath(profileId, "billing-details"),
        validateStatus: (response) => response.ok || response.status === HTTP_STATUS.notFound,
      }),
      transformResponse: (data: BillingDetails, meta) =>
        meta?.response?.status === HTTP_STATUS.notFound ? null : data,
      responseSchema: billingDetailsSchema.nullable(),
    }),
    saveBillingDetails: build.mutation<
      BillingDetails,
      { profileId: string; body: BillingDetailsBody }
    >({
      query: ({ profileId, body }) => ({
        url: profilePath(profileId, "billing-details"),
        method: "PUT",
        body,
      }),
      argSchema: z.object({ profileId: z.guid(), body: billingDetailsBodySchema }),
      responseSchema: billingDetailsSchema,
      async onQueryStarted({ profileId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getBillingDetails", profileId, data));
        } catch {
          // Shown by the form.
        }
      },
    }),
    getNotifications: build.query<Notifications, string>({
      query: (profileId) => profilePath(profileId, "notifications"),
      responseSchema: notificationsSchema,
    }),
    saveNotifications: build.mutation<Notifications, { profileId: string; email: boolean }>({
      query: ({ profileId, email }) => ({
        url: profilePath(profileId, "notifications"),
        method: "PUT",
        body: { email },
      }),
      responseSchema: notificationsSchema,
      async onQueryStarted({ profileId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getNotifications", profileId, data));
        } catch {
          // Shown by the page.
        }
      },
    }),
    /** Every other cached read was of the old mode, so each reads again. */
    saveProfileMode: build.mutation<
      { livemode: boolean },
      { profileId: string; livemode: boolean }
    >({
      query: ({ profileId, livemode }) => ({
        url: profilePath(profileId, "mode"),
        method: "PUT",
        body: { livemode },
      }),
      responseSchema: profileModeSchema,
      async onQueryStarted({ profileId }, { dispatch, getState, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            profilesApi.util.updateQueryData("signUp", undefined, (me) => {
              const profile = me.profiles.find((p) => p.profileId === profileId);
              if (profile) profile.livemode = data.livemode;
            }),
          );
          for (const entry of Object.values(getState().api.queries)) {
            if (entry && entry.endpointName !== "signUp")
              dispatch(
                apiSlice.util.prefetch(entry.endpointName as never, entry.originalArgs as never, {
                  force: true,
                }),
              );
          }
        } catch {
          // Shown by the page.
        }
      },
    }),
    saveProfileFees: build.mutation<
      { feesPaidBy: FeesPaidBy },
      { profileId: string; feesPaidBy: FeesPaidBy }
    >({
      query: ({ profileId, feesPaidBy }) => ({
        url: profilePath(profileId, "fees"),
        method: "PUT",
        body: { feesPaidBy },
      }),
      responseSchema: profileFeesSchema,
      async onQueryStarted({ profileId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            profilesApi.util.updateQueryData("signUp", undefined, (me) => {
              const profile = me.profiles.find((p) => p.profileId === profileId);
              if (profile) profile.feesPaidBy = data.feesPaidBy;
            }),
          );
        } catch {
          // Shown by the page.
        }
      },
    }),
    // upsertQueryData runs this schema on the list, so it checks the list itself.
    getProfileTokens: build.query<TokenSwitch[], string>({
      query: (profileId) => profilePath(profileId, "tokens"),
      transformResponse: (data: { tokens: TokenSwitch[] }) => data.tokens,
      responseSchema: profileTokensSchema.shape.tokens,
    }),
    getCrossChainSwitch: build.query<boolean, string>({
      query: (profileId) => profilePath(profileId, "tokens"),
      transformResponse: (data: { crossChain: boolean }) => data.crossChain,
      responseSchema: z.boolean(),
    }),
    saveCrossChainSwitch: build.mutation<boolean, { profileId: string; on: boolean }>({
      query: ({ profileId, on }) => ({
        url: profilePath(profileId, "tokens"),
        method: "PUT",
        body: { crossChain: on },
      }),
      argSchema: z.object({ profileId: z.guid(), on: z.boolean() }),
      transformResponse: (data: { crossChain: boolean }) => data.crossChain,
      responseSchema: z.boolean(),
      async onQueryStarted({ profileId, on }, { dispatch, queryFulfilled }) {
        const guess = dispatch(
          profilesApi.util.updateQueryData("getCrossChainSwitch", profileId, () => on),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getCrossChainSwitch", profileId, data));
        } catch {
          // Shown by the page.
          guess.undo();
        }
      },
    }),
    saveProfileTokens: build.mutation<TokenSwitch[], { profileId: string; off: TokenRef[] }>({
      query: ({ profileId, off }) => ({
        url: profilePath(profileId, "tokens"),
        method: "PUT",
        body: { off },
      }),
      transformResponse: (data: { tokens: TokenSwitch[] }) => data.tokens,
      responseSchema: profileTokensSchema.shape.tokens,
      async onQueryStarted({ profileId, off }, { dispatch, queryFulfilled }) {
        const guess = dispatch(
          profilesApi.util.updateQueryData("getProfileTokens", profileId, (tokens) => {
            for (const t of tokens)
              t.on = !off.some((o) => o.chainId === t.chainId && o.token === t.token);
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getProfileTokens", profileId, data));
        } catch {
          // Shown by the page.
          guess.undo();
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
  useGetProfileTokensQuery,
  useSaveProfileTokensMutation,
  useGetCrossChainSwitchQuery,
  useSaveCrossChainSwitchMutation,
  useSaveProfileModeMutation,
  useSaveProfileFeesMutation,
} = profilesApi;
