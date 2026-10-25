import { z } from "zod";
import { linkBodySchema, linkSchema, linksSchema } from "@/features/links/schemas/links";
import type { Link, LinkBody } from "@/features/links/types/links";
import { apiSlice } from "@/shared/api/api-slice";

const LINKS_TAG = "Links";

const linksUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/links`;

export const linksApi = apiSlice.enhanceEndpoints({ addTagTypes: [LINKS_TAG] }).injectEndpoints({
  endpoints: (build) => ({
    listLinks: build.query<Link[], string>({
      query: (profileId) => linksUrl(profileId),
      rawResponseSchema: linksSchema,
      transformResponse: (data: { links: Link[] }) => data.links,
      providesTags: [LINKS_TAG],
    }),
    /** PUT to an id the browser picks, so a retried save makes one link (as a store). */
    saveLink: build.mutation<Link, { profileId: string; linkId: string; body: LinkBody }>({
      query: ({ profileId, linkId, body }) => ({
        url: `${linksUrl(profileId)}/${encodeURIComponent(linkId)}`,
        method: "PUT",
        body,
      }),
      argSchema: z.object({ profileId: z.guid(), linkId: z.guid(), body: linkBodySchema }),
      responseSchema: linkSchema,
      invalidatesTags: [LINKS_TAG],
    }),
  }),
});

export const { useListLinksQuery, useSaveLinkMutation } = linksApi;
