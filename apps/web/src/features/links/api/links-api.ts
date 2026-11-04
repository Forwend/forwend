import { z } from "zod";
import { LINKS_PAGE_SIZE } from "@/features/links/constants/links";
import {
  linkBodySchema,
  linkPayArgSchema,
  linkPaySchema,
  linkSchema,
  linksPageSchema,
  publicLinkSchema,
} from "@/features/links/schemas/links";
import type {
  Link,
  LinkBody,
  LinkPay,
  LinkPayArg,
  LinksPage,
  PublicLink,
} from "@/features/links/types/links";
import { apiSlice } from "@/shared/api/api-slice";

const LINKS_TAG = "Links";

const linksUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/links`;

export const linksApi = apiSlice.enhanceEndpoints({ addTagTypes: [LINKS_TAG] }).injectEndpoints({
  endpoints: (build) => ({
    listLinks: build.infiniteQuery<LinksPage, string, string | null>({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (last) => last.nextCursor,
      },
      query: ({ queryArg: profileId, pageParam }) => ({
        url: linksUrl(profileId),
        params: { limit: LINKS_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
      responseSchema: linksPageSchema,
      providesTags: [LINKS_TAG],
    }),
    getLink: build.query<Link, { profileId: string; linkId: string }>({
      query: ({ profileId, linkId }) => `${linksUrl(profileId)}/${encodeURIComponent(linkId)}`,
      responseSchema: linkSchema,
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
    /** The payer's read (R-142): public, like the checkout. */
    getPublicLink: build.query<PublicLink, string>({
      query: (slug) => `/v1/links/${encodeURIComponent(slug)}`,
      responseSchema: publicLinkSchema,
    }),
    /** One page load (R-142); the page makes nothing (D-54). */
    countLinkVisit: build.mutation<void, string>({
      extraOptions: { answerFirst: true },
      query: (slug) => ({ url: `/v1/links/${encodeURIComponent(slug)}/visits`, method: "POST" }),
    }),
    /** Creates a quoted purchase or replays the original request after an uncertain response. */
    payLink: build.mutation<LinkPay, LinkPayArg>({
      extraOptions: { answerFirst: true },
      query: ({ slug, amountUsd, expectedAmountUsd, expectedVersion, idempotencyKey }) => ({
        url: `/v1/links/${encodeURIComponent(slug)}/pay`,
        method: "POST",
        body: { ...(amountUsd ? { amountUsd } : {}), expectedAmountUsd, expectedVersion },
        headers: { "Idempotency-Key": idempotencyKey },
      }),
      argSchema: linkPayArgSchema,
      responseSchema: linkPaySchema,
    }),
  }),
});

export const {
  useListLinksInfiniteQuery,
  useGetLinkQuery,
  useSaveLinkMutation,
  useGetPublicLinkQuery,
  useCountLinkVisitMutation,
  usePayLinkMutation,
} = linksApi;
