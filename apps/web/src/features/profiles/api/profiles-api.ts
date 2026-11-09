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
import type { FeesPaidBy, Me, Profile, ProfileKind } from "@/features/profiles/types/profile";
import type { TokenRef, TokenSwitch } from "@/features/profiles/types/tokens";
import { apiSlice } from "@/shared/api/api-slice";

const NOT_FOUND = 404;

const billingDetailsUrl = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/billing-details`;
const notificationsUrl = (profileId: string) =>
  `/v1/profiles/${encodeURIComponent(profileId)}/notifications`;
const tokensUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/tokens`;
const modeUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/mode`;
const feesUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/fees`;

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
    /** R-221: Developer mode, false livemode. Every other cached read was of the old mode, so each reads again; the
     *  profile list only changes the mode, so the app shell stays as it is. */
    saveProfileMode: build.mutation<
      { livemode: boolean },
      { profileId: string; livemode: boolean }
    >({
      query: ({ profileId, livemode }) => ({
        url: modeUrl(profileId),
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
          // The page shows the error.
        }
      },
    }),
    /** D-122: who pays the profile's new invoices' fees; the profile list keeps it. */
    saveProfileFees: build.mutation<
      { feesPaidBy: FeesPaidBy },
      { profileId: string; feesPaidBy: FeesPaidBy }
    >({
      query: ({ profileId, feesPaidBy }) => ({
        url: feesUrl(profileId),
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
          // The page shows the error.
        }
      },
    }),
    /** R-136: every enabled token, on until the profile turns it off. */
    // The schema checks the list itself, as upsertQueryData below runs the endpoint's schemas on it.
    getProfileTokens: build.query<TokenSwitch[], string>({
      query: (profileId) => tokensUrl(profileId),
      transformResponse: (data: { tokens: TokenSwitch[] }) => data.tokens,
      responseSchema: profileTokensSchema.shape.tokens,
    }),
    /** R-240: whether payers may pay from other chains through NEAR Intents; on by default. */
    getCrossChainSwitch: build.query<boolean, string>({
      query: (profileId) => tokensUrl(profileId),
      transformResponse: (data: { crossChain?: boolean }) => data.crossChain ?? true,
    }),
    /** Saves the switch with the tokens the profile has off, as the route takes both. */
    saveCrossChainSwitch: build.mutation<
      boolean,
      { profileId: string; off: TokenRef[]; on: boolean }
    >({
      query: ({ profileId, off, on }) => ({
        url: tokensUrl(profileId),
        method: "PUT",
        body: { off, crossChain: on },
      }),
      transformResponse: (data: { crossChain?: boolean }) => data.crossChain ?? true,
      async onQueryStarted({ profileId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(profilesApi.util.upsertQueryData("getCrossChainSwitch", profileId, data));
        } catch {
          // The page shows the error, and the switch keeps the saved value.
        }
      },
    }),
    saveProfileTokens: build.mutation<TokenSwitch[], { profileId: string; off: TokenRef[] }>({
      query: ({ profileId, off }) => ({ url: tokensUrl(profileId), method: "PUT", body: { off } }),
      transformResponse: (data: { tokens: TokenSwitch[] }) => data.tokens,
      responseSchema: profileTokensSchema.shape.tokens,
      // The boxes move at once; the API's answer then replaces the guess, and a refusal puts the old ones back.
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
          // The page shows the error.
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
