import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { useEffect } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { apiSlice } from "@/shared/api/api-slice";
import { REFRESH_MS } from "@/shared/config/refresh";
import type { AppDispatch, RootState } from "@/store/store";

const GATEWAY = [502, 503, 504];

/** A read that never reached the api: no connection, no answer in time, or a gateway's answer instead of the api's
 * JSON (the web server's proxy answers a plain 500 when the api is down). */
export function unreachable(error: unknown): boolean {
  const e = error as FetchBaseQueryError | undefined;
  if (!e) return false;
  if (e.status === "FETCH_ERROR" || e.status === "TIMEOUT_ERROR") return true;
  if (e.status === "PARSING_ERROR") return e.originalStatus >= 500;
  return typeof e.status === "number" && GATEWAY.includes(e.status);
}

/** Any read whose last answer was unreachable. error, not isError: a retry keeps it, so the strip doesn't blink. */
export function useServerUnreachable(): boolean {
  return useSelector((state: RootState) =>
    Object.values(state[apiSlice.reducerPath].queries).some((q) => unreachable(q?.error)),
  );
}

type Refetch = (arg: unknown, options: { subscribe: false; forceRefetch: true }) => never;

/** While the api is unreachable, reads it again on the refresh's beat, also those that don't poll, so every view
 * recovers once it answers. */
export function useRetryUnreachable(down: boolean) {
  const store = useStore<RootState>();
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    if (!down) return;
    const timer = setInterval(() => {
      const endpoints = apiSlice.endpoints as unknown as Record<string, { initiate: Refetch }>;
      for (const q of Object.values(store.getState()[apiSlice.reducerPath].queries)) {
        const endpoint = q?.endpointName ? endpoints[q.endpointName] : undefined;
        if (endpoint && q?.status !== "pending" && unreachable(q?.error))
          dispatch(endpoint.initiate(q?.originalArgs, { subscribe: false, forceRefetch: true }));
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [down, store, dispatch]);
}
