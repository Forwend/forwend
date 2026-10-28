import { ACTIVITY_PAGE_SIZE } from "@/features/activity/constants/activity";
import { activityPageSchema } from "@/features/activity/schemas/activity";
import type { ActivityPage, StatusFilter } from "@/features/activity/types/activity";
import { apiSlice } from "@/shared/api/api-slice";

export const activityApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** Cursor pages, so history reaches its start however long it is. */
    getActivity: build.infiniteQuery<
      ActivityPage,
      { profileId: string; status?: StatusFilter; q?: string },
      string | null
    >({
      infiniteQueryOptions: { initialPageParam: null, getNextPageParam: (last) => last.nextCursor },
      query: ({ queryArg: { profileId, ...params }, pageParam }) => ({
        url: `/v1/profiles/${encodeURIComponent(profileId)}/activity`,
        params: {
          ...params,
          limit: ACTIVITY_PAGE_SIZE,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
      responseSchema: activityPageSchema,
    }),
  }),
});

export const { useGetActivityInfiniteQuery } = activityApi;
