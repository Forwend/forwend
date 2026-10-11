import type { ActivityPage, StatusFilter } from "@/features/activity/activity";
import { apiSlice } from "@/shared/api/api-slice";

export const activityApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** Under the status filter and search when given. */
    getActivity: build.query<
      ActivityPage,
      { profileId: string; limit: number; status?: StatusFilter; q?: string }
    >({
      query: ({ profileId, ...params }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/activity`,
        params,
      }),
    }),
  }),
});

export const { useGetActivityQuery } = activityApi;
