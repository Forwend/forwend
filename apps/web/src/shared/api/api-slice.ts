import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { type AskFreshSignIn, withFreshSignIn } from "@/shared/api/fresh-sign-in";
import { withRateLimit } from "@/shared/api/rate-limit";
import { API_BASE } from "@/shared/config/api";

/** Store extras for each request; public pages have no freshSignIn. */
export interface ApiExtra {
  getAccessToken: () => Promise<string | null>; // null when signed out
  freshSignIn?: AskFreshSignIn;
}

// One slice for our backend; each feature adds its endpoints with injectEndpoints.
export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery: withFreshSignIn(
    withRateLimit(
      fetchBaseQuery({
        baseUrl: API_BASE,
        // The api stops writing an answer after 30 s; a request still open then is a stalled connection, so fail it.
        timeout: 30_000,
        prepareHeaders: async (headers, { extra }) => {
          const token = await (extra as ApiExtra).getAccessToken();
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return headers;
        },
      }),
    ),
    (extra) => (extra as ApiExtra).freshSignIn,
  ),
  // A response that breaks its schema fails the request, so the page never draws money from an untrusted value.
  // The log names the endpoint and the fields, never the values.
  catchSchemaFailure: (error) => ({
    status: "CUSTOM_ERROR" as const,
    error: `${error.schemaName} failed validation`,
  }),
  onSchemaFailure: (error, info) => {
    const fields = error.issues.map((issue) =>
      (issue.path ?? [])
        .map((part) => (typeof part === "object" ? String(part.key) : String(part)))
        .join("."),
    );
    console.error(`${info.endpoint}: ${error.schemaName} failed at ${fields.join(", ")}`);
  },
  tagTypes: ["PendingSends"],
  endpoints: () => ({}),
});
