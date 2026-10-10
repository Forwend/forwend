import type { ActivityPage } from "@/features/activity/activity";
import { apiSlice } from "@/shared/api/api-slice";

export const activityApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getActivity: build.query<ActivityPage, { profileId: string; limit: number }>({
      query: ({ profileId, limit }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/activity`,
        params: { limit },
      }),
    }),
  }),
});

export const { useGetActivityQuery } = activityApi;
