import { z } from "zod";
import { CLIENT_PICKER_SIZE, CLIENTS_PAGE_SIZE } from "@/features/clients/constants/clients";
import {
  clientSchema,
  clientsPageSchema,
  savedClientBodySchema,
} from "@/features/clients/schemas/clients";
import type { Client, ClientsPage, SavedClientBody } from "@/features/clients/types/clients";
import { apiSlice } from "@/shared/api/api-slice";

const CLIENTS_TAG = "Clients";

const clientsUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/clients`;
const clientUrl = (profileId: string, clientId: string) =>
  `${clientsUrl(profileId)}/${encodeURIComponent(clientId)}`;

export const clientsApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [CLIENTS_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
      /** R-177: one page at a time, by name; q searches the name, the email and the tax ID. */
      listClients: build.infiniteQuery<
        ClientsPage,
        { profileId: string; q?: string },
        string | null
      >({
        infiniteQueryOptions: {
          initialPageParam: null,
          getNextPageParam: (last) => last.nextCursor,
        },
        query: ({ queryArg: { profileId, q }, pageParam }) => ({
          url: clientsUrl(profileId),
          params: {
            limit: CLIENTS_PAGE_SIZE,
            ...(q ? { q } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
        responseSchema: clientsPageSchema,
        providesTags: [CLIENTS_TAG],
      }),
      /** A client picker's first matches for what is typed, or the first clients by name. */
      searchClients: build.query<Client[], { profileId: string; q?: string }>({
        query: ({ profileId, q }) => ({
          url: clientsUrl(profileId),
          params: { limit: CLIENT_PICKER_SIZE, ...(q ? { q } : {}) },
        }),
        rawResponseSchema: clientsPageSchema,
        transformResponse: (data: ClientsPage) => data.items,
        providesTags: [CLIENTS_TAG],
      }),
      /** 404 for another profile's client or one that was deleted. */
      getClient: build.query<Client, { profileId: string; clientId: string }>({
        query: ({ profileId, clientId }) => clientUrl(profileId, clientId),
        responseSchema: clientSchema,
        providesTags: [CLIENTS_TAG],
      }),
      /** PUT to an id the browser picks, so a retried save makes one client (R-86). */
      saveClient: build.mutation<
        Client,
        { profileId: string; clientId: string; body: SavedClientBody }
      >({
        query: ({ profileId, clientId, body }) => ({
          url: clientUrl(profileId, clientId),
          method: "PUT",
          body,
        }),
        argSchema: z.object({
          profileId: z.guid(),
          clientId: z.guid(),
          body: savedClientBodySchema,
        }),
        responseSchema: clientSchema,
        invalidatesTags: [CLIENTS_TAG],
      }),
      deleteClient: build.mutation<void, { profileId: string; clientId: string }>({
        query: ({ profileId, clientId }) => ({
          url: clientUrl(profileId, clientId),
          method: "DELETE",
        }),
        invalidatesTags: [CLIENTS_TAG],
      }),
    }),
  });

export const {
  useListClientsInfiniteQuery,
  useSearchClientsQuery,
  useGetClientQuery,
  useSaveClientMutation,
  useDeleteClientMutation,
} = clientsApi;
