import { activityPageSchema } from "@/features/activity/schemas/activity";
import type { ActivityPage, StatusFilter } from "@/features/activity/types/activity";
import { apiSlice } from "@/shared/api/api-slice";

export const activityApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getActivity: build.query<
      ActivityPage,
      { profileId: string; limit: number; status?: StatusFilter; q?: string }
    >({
      query: ({ profileId, ...params }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/activity`,
        params,
      }),
      responseSchema: activityPageSchema,
    }),
  }),
});

export const { useGetActivityQuery } = activityApi;
