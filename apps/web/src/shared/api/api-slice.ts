import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { withRateLimit } from "@/shared/api/rate-limit";
import { API_BASE } from "@/shared/config/api";

/** What the store gives each request: a fresh Privy access token, or null when signed out. */
export interface ApiExtra {
  getAccessToken: () => Promise<string | null>;
}

// One slice for our backend; each feature adds its endpoints with injectEndpoints.
export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery: withRateLimit(
    fetchBaseQuery({
      baseUrl: API_BASE,
      prepareHeaders: async (headers, { extra }) => {
        const token = await (extra as ApiExtra).getAccessToken();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return headers;
      },
    }),
  ),
  // A response that breaks its schema is a failed request, shown like any other failure: the page never draws money
  // from a value it cannot trust. The log names the endpoint and the fields, never the values.
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
  endpoints: () => ({}),
});
