import { z } from "zod";
import {
  clientSchema,
  clientsSchema,
  savedClientBodySchema,
} from "@/features/clients/schemas/clients";
import type { Client, SavedClientBody } from "@/features/clients/types/clients";
import { apiSlice } from "@/shared/api/api-slice";

const CLIENTS_TAG = "Clients";

const clientsUrl = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/clients`;
const clientUrl = (profileId: string, clientId: string) =>
  `${clientsUrl(profileId)}/${encodeURIComponent(clientId)}`;

export const clientsApi = apiSlice
  .enhanceEndpoints({ addTagTypes: [CLIENTS_TAG] })
  .injectEndpoints({
    endpoints: (build) => ({
      /** At most 1000, so one request holds them all. */
      listClients: build.query<Client[], string>({
        query: (profileId) => clientsUrl(profileId),
        rawResponseSchema: clientsSchema,
        transformResponse: (data: { clients: Client[] }) => data.clients,
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

export const { useListClientsQuery, useSaveClientMutation, useDeleteClientMutation } = clientsApi;
