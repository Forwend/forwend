import { ACTIVITY_PAGE_SIZE } from "@/features/activity/constants/activity";
import { activityPageSchema } from "@/features/activity/schemas/activity";
import type { ActivityPage } from "@/features/activity/types/activity";
import { apiSlice, profilePath } from "@/shared/api/api-slice";
import type { ApiPaymentState } from "@/shared/types/payment-state";

export const activityApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getActivity: build.infiniteQuery<
      ActivityPage,
      { profileId: string; state?: ApiPaymentState; q?: string },
      string | null
    >({
      infiniteQueryOptions: { initialPageParam: null, getNextPageParam: (last) => last.nextCursor },
      query: ({ queryArg: { profileId, ...params }, pageParam }) => ({
        url: profilePath(profileId, "activity"),
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
