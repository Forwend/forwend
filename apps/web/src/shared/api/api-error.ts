import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";

export const HTTP_STATUS = {
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
  invalidValue: 422,
  tooManyRequests: 429,
  unavailable: 503,
} as const;

/** A failed request's HTTP status, or RTK's own string when no answer came. */
export function errorStatus(error: unknown): FetchBaseQueryError["status"] | undefined {
  return (error as FetchBaseQueryError | undefined)?.status;
}

/** The api's error body, `{ "error": { "code", "message" } }`; empty when the answer had none. */
export function apiError(error: unknown): { code?: string; message?: string } {
  const data = (error as FetchBaseQueryError | undefined)?.data as
    | { error?: { code?: string; message?: string } }
    | null
    | undefined;
  return data?.error ?? {};
}

/** The api answered that the record is not there: another profile's, deleted, or out of the member's reach. */
export function notFound(error: unknown): boolean {
  return errorStatus(error) === HTTP_STATUS.notFound;
}

export function invalidValue(error: unknown): boolean {
  return errorStatus(error) === HTTP_STATUS.invalidValue;
}

/** The api names a refused field only in its message: "invalid job request: client.email must be …". */
export function namedField<F extends string>(error: unknown, fields: readonly F[]): F | null {
  const name = apiError(error).message?.split(": ")[1]?.split(" ")[0];
  return fields.find((field) => field === name) ?? null;
}
