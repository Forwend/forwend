import { z } from "zod";
import { profilesApi } from "@/features/profiles/api/profiles-api";
import {
  acceptedSchema,
  grantBodySchema,
  invitationSchema,
  inviteBodySchema,
  inviteSchema,
  memberSchema,
  teamSchema,
} from "@/features/team/schemas/team";
import type {
  GrantBody,
  Invitation,
  Invite,
  InviteBody,
  Member,
  Team,
} from "@/features/team/types/team";
import { apiSlice } from "@/shared/api/api-slice";

const TEAM_TAG = "Team";

const profileUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}`;

// An Admin may change or remove themselves: the user's profiles and permissions are read again, so the app shows
// only what is left (D-93).
async function readMeAgain(
  dispatch: (action: unknown) => unknown,
  queryFulfilled: Promise<unknown>,
): Promise<void> {
  try {
    await queryFulfilled;
    await dispatch(
      profilesApi.endpoints.signUp.initiate(undefined, { forceRefetch: true, subscribe: false }),
    );
  } catch {
    // The dialog shows the error.
  }
}

export const teamApi = apiSlice.enhanceEndpoints({ addTagTypes: [TEAM_TAG] }).injectEndpoints({
  endpoints: (build) => ({
    getTeam: build.query<Team, string>({
      query: (profileId) => `${profileUrl(profileId)}/members`,
      responseSchema: teamSchema,
      providesTags: [TEAM_TAG],
    }),
    /** D-63: giving a role needs a fresh sign-in, which the request asks for when the API answers 401. */
    invite: build.mutation<Invite, { profileId: string; body: InviteBody }>({
      query: ({ profileId, body }) => ({
        url: `${profileUrl(profileId)}/invites`,
        method: "POST",
        body,
      }),
      argSchema: z.object({ profileId: z.guid(), body: inviteBodySchema }),
      responseSchema: inviteSchema,
      invalidatesTags: [TEAM_TAG],
    }),
    revokeInvite: build.mutation<void, { profileId: string; inviteId: string }>({
      query: ({ profileId, inviteId }) => ({
        url: `${profileUrl(profileId)}/invites/${encodeURIComponent(inviteId)}`,
        method: "DELETE",
      }),
      invalidatesTags: [TEAM_TAG],
    }),
    /** D-63, as an invite. */
    setMember: build.mutation<Member, { profileId: string; memberId: string; body: GrantBody }>({
      query: ({ profileId, memberId, body }) => ({
        url: `${profileUrl(profileId)}/members/${encodeURIComponent(memberId)}`,
        method: "PUT",
        body,
      }),
      argSchema: z.object({ profileId: z.guid(), memberId: z.guid(), body: grantBodySchema }),
      responseSchema: memberSchema,
      invalidatesTags: [TEAM_TAG],
      onQueryStarted: (_, { dispatch, queryFulfilled }) => readMeAgain(dispatch, queryFulfilled),
    }),
    removeMember: build.mutation<void, { profileId: string; memberId: string }>({
      query: ({ profileId, memberId }) => ({
        url: `${profileUrl(profileId)}/members/${encodeURIComponent(memberId)}`,
        method: "DELETE",
      }),
      invalidatesTags: [TEAM_TAG],
      onQueryStarted: (_, { dispatch, queryFulfilled }) => readMeAgain(dispatch, queryFulfilled),
    }),
    /** The profile leaves the user's list at once, so the app moves to another. */
    leaveTeam: build.mutation<void, string>({
      query: (profileId) => ({ url: `${profileUrl(profileId)}/leave`, method: "POST" }),
      async onQueryStarted(profileId, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          dispatch(
            profilesApi.util.updateQueryData("signUp", undefined, (me) => {
              me.profiles = me.profiles.filter((p) => p.profileId !== profileId);
            }),
          );
        } catch {
          // The dialog shows the error.
        }
      },
    }),
    getInvitation: build.query<Invitation, string>({
      query: (token) => `/v1/invites/${encodeURIComponent(token)}`,
      responseSchema: invitationSchema,
    }),
    acceptInvite: build.mutation<{ profileId: string }, string>({
      query: (token) => ({
        url: `/v1/invites/${encodeURIComponent(token)}/accept`,
        method: "POST",
      }),
      responseSchema: acceptedSchema,
    }),
  }),
});

export const {
  useGetTeamQuery,
  useInviteMutation,
  useRevokeInviteMutation,
  useSetMemberMutation,
  useRemoveMemberMutation,
  useLeaveTeamMutation,
  useGetInvitationQuery,
  useAcceptInviteMutation,
} = teamApi;
